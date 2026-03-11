import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { KeilConfigCheckResult, KeilTaskResult } from './types';

type JLinkInterface = 'SWD' | 'JTAG';

interface KeilTargetMeta {
  name: string;
  outputDirectory?: string;
  outputName?: string;
  deviceName?: string;
}

interface ProjectMeta {
  targets: KeilTargetMeta[];
}

interface JLinkDeviceCandidate {
  cpuName: string;
  vendor?: string;
  source: 'project' | 'jlink-db';
}

export interface BuildResult extends KeilTaskResult {}

interface BuildLogSummary {
  errorCount?: number;
  warningCount?: number;
  hasErrorKeyword: boolean;
}

function decodeXmlText(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function extractTag(block: string, tagName: string): string | undefined {
  const matcher = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i').exec(block);
  if (!matcher?.[1]) { return undefined; }
  return decodeXmlText(matcher[1]);
}

function stripWrappedQuotes(input: string): string {
  const trimmed = input.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export class KeilToolchainService {
  constructor(private readonly output: vscode.OutputChannel) {}

  openSettings(): void {
    vscode.commands.executeCommand('workbench.action.openSettings', 'serialagent.');
  }

  async selectJLinkDeviceFromProject(): Promise<void> {
    const projectFile = await this.resolveProjectFile();
    const projectMeta = this.parseUvprojx(projectFile);

    const selectedTarget = this.resolveTargetName(projectMeta);
    const candidates = this.loadJLinkDeviceCandidates(projectMeta, selectedTarget);
    const items = candidates.map((dev) => ({
      label: dev.cpuName,
      description: dev.vendor || (dev.source === 'project' ? 'from .uvprojx' : 'from JLink DB'),
      detail: dev.source === 'project' ? 'Project Target Device' : 'JLink Device Library',
    }));

    if (!items.length) {
      throw new Error('No available JLink CPU candidates found. Please set Device in .uvprojx target, or check JLink install directory.');
    }

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Select JLink CPU Name',
      placeHolder: 'Pick device from Keil target or JLink library',
      canPickMany: false,
    });

    if (!selected) {
      return;
    }

    const conf = vscode.workspace.getConfiguration('serialagent');
    const hasWorkspace = (vscode.workspace.workspaceFolders?.length || 0) > 0;

    if (hasWorkspace) {
      await conf.update('jlink.device', selected.label, vscode.ConfigurationTarget.Workspace);
    }
    await conf.update('jlink.device', selected.label, vscode.ConfigurationTarget.Global);

    this.output.appendLine(`[JLink] Selected CPU: ${selected.label}`);
    this.output.appendLine(`[JLink] Saved to: ${hasWorkspace ? 'Workspace + User' : 'User'}`);
  }

  async build(): Promise<BuildResult> {
    const projectFile = await this.resolveProjectFile();
    const uv4Path = this.resolveUv4Path();
    const armcc5Path = this.getConfigValue<string>('keil.armcc5Path', '');
    const projectMeta = this.parseUvprojx(projectFile);
    const selectedTarget = this.resolveTargetName(projectMeta);
    const buildLogFile = path.join(os.tmpdir(), `serialagent-keil-build-${Date.now()}.log`);

    this.output.appendLine(`[Keil] Project: ${projectFile}`);
    this.output.appendLine(`[Keil] UV4: ${uv4Path}`);
    if (armcc5Path.trim()) {
      this.output.appendLine(`[Keil] ARMCC5: ${armcc5Path}`);
    }
    if (selectedTarget) {
      this.output.appendLine(`[Keil] Target: ${selectedTarget}`);
    }

    const args = ['-j0', '-b', projectFile, '-o', buildLogFile];
    if (selectedTarget) {
      args.push('-t', selectedTarget);
    }

    const uv4Dir = path.dirname(uv4Path);
    const env = { ...process.env };
    const pathParts = [
      armcc5Path.trim(),
      uv4Dir,
      process.env.PATH || '',
    ].filter(Boolean);
    env.PATH = pathParts.join(path.delimiter);

    const code = await this.runProcess(uv4Path, args, env);
    const summary = this.appendBuildLog(buildLogFile);

    let artifactPath: string | undefined;
    try {
      artifactPath = await this.resolveArtifact(projectFile, projectMeta, selectedTarget);
    } catch {
      artifactPath = undefined;
    }

    const verdict = this.evaluateBuildResult(code, summary, artifactPath);
    if (!verdict.success) {
      throw new Error(`Keil build failed: ${verdict.reason}`);
    }

    if (!artifactPath) {
      throw new Error('Keil build appears successful, but no artifact found (.hex/.axf/.bin). Please verify Keil output settings.');
    }

    if (code !== 0) {
      this.output.appendLine(`[Keil] Non-zero exit code (${code}) accepted by policy: ${verdict.reason}`);
    }
    this.output.appendLine(`[Keil] Build done. Artifact: ${artifactPath}`);

    return {
      success: true,
      projectFile,
      target: selectedTarget,
      artifactPath,
    };
  }

  async flash(artifactPathInput?: string): Promise<{ success: boolean; artifactPath: string; projectFile: string }> {
    const projectFile = await this.resolveProjectFile();
    const projectMeta = this.parseUvprojx(projectFile);
    const selectedTarget = this.resolveTargetName(projectMeta);
    const artifactPath = artifactPathInput ?? await this.resolveArtifact(projectFile, projectMeta, selectedTarget);
    const jlinkExe = this.resolveJLinkExePath();

    const jlinkDevice = this.resolveJLinkDevice(projectMeta, selectedTarget);

    const jlinkInterface = (this.getConfigValue<string>('jlink.interface', 'SWD').toUpperCase() === 'JTAG' ? 'JTAG' : 'SWD') as JLinkInterface;
    const jlinkSpeed = this.getConfigValue<number>('jlink.speed', 4000);
    const jlinkBaseAddr = this.getConfigValue<string>('jlink.baseAddr', '0x08000000').trim();

    const workDir = path.join(os.tmpdir(), 'serialagent-jlink');
    fs.mkdirSync(workDir, { recursive: true });
    const cmdFile = path.join(workDir, `commands-${Date.now()}.jlink`);

    const commands: string[] = ['r', 'halt'];
    if (/\.bin$/i.test(artifactPath)) {
      commands.push(`loadfile "${artifactPath}",${jlinkBaseAddr}`);
    } else {
      commands.push(`loadfile "${artifactPath}"`);
    }
    commands.push('r', 'go', 'exit');
    fs.writeFileSync(cmdFile, `${commands.join(os.EOL)}${os.EOL}`, 'utf8');

    this.output.appendLine(`[JLink] Exe: ${jlinkExe}`);
    this.output.appendLine(`[JLink] Device: ${jlinkDevice}`);
    this.output.appendLine(`[JLink] Interface: ${jlinkInterface}`);
    this.output.appendLine(`[JLink] Speed: ${jlinkSpeed}`);
    if (/\.bin$/i.test(artifactPath)) {
      this.output.appendLine(`[JLink] Bin BaseAddr: ${jlinkBaseAddr}`);
    }
    this.output.appendLine(`[JLink] Script: ${cmdFile}`);

    const args = [
      '-ExitOnError', '1',
      '-AutoConnect', '1',
      '-Device', jlinkDevice,
      '-If', jlinkInterface,
      '-Speed', `${jlinkSpeed}`,
      '-CommandFile', cmdFile,
    ];

    const code = await this.runProcess(jlinkExe, args, process.env);
    if (code !== 0) {
      throw new Error(`JLink flash failed with exit code ${code}`);
    }

    this.output.appendLine('[JLink] Flash done.');
    return { success: true, artifactPath, projectFile };
  }

  async buildAndFlash(): Promise<{ success: boolean; artifactPath: string; projectFile: string }> {
    const buildResult = await this.build();
    const flashResult = await this.flash(buildResult.artifactPath);
    return { success: true, artifactPath: flashResult.artifactPath, projectFile: flashResult.projectFile };
  }

  async checkConfig(): Promise<KeilConfigCheckResult> {
    const checks: KeilConfigCheckResult['checks'] = [];
    let projectFile: string | undefined;
    let target: string | undefined;
    let projectMeta: ProjectMeta | undefined;

    try {
      projectFile = await this.resolveProjectFile();
      checks.push({ key: 'keil.projectFile', ok: true, message: 'Project file found', value: projectFile });
      projectMeta = this.parseUvprojx(projectFile);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push({ key: 'keil.projectFile', ok: false, message: msg });
    }

    if (projectMeta) {
      try {
        target = this.resolveTargetName(projectMeta);
        checks.push({ key: 'keil.target', ok: true, message: 'Target resolved', value: target });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        checks.push({ key: 'keil.target', ok: false, message: msg });
      }
    } else {
      checks.push({ key: 'keil.target', ok: false, message: 'Target check skipped because project file is unavailable' });
    }

    try {
      const uv4 = this.resolveUv4Path();
      checks.push({ key: 'keil.uv4Path', ok: true, message: 'UV4 executable found', value: uv4 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push({ key: 'keil.uv4Path', ok: false, message: msg });
    }

    try {
      const jlinkExe = this.resolveJLinkExePath();
      checks.push({ key: 'jlink.installDirectory', ok: true, message: 'JLink executable found', value: jlinkExe });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push({ key: 'jlink.installDirectory', ok: false, message: msg });
    }

    if (projectMeta) {
      try {
        const jlinkDevice = this.resolveJLinkDevice(projectMeta, target);
        checks.push({ key: 'jlink.device', ok: true, message: 'JLink device resolved', value: jlinkDevice });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        checks.push({ key: 'jlink.device', ok: false, message: msg });
      }
    } else {
      checks.push({ key: 'jlink.device', ok: false, message: 'JLink device check skipped because project file is unavailable' });
    }

    return {
      ready: checks.every(item => item.ok),
      checks,
      projectFile,
      target,
    };
  }

  private getConfigValue<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration('serialagent').get<T>(key, fallback);
  }

  private resolveUv4Path(): string {
    const configured = stripWrappedQuotes(this.getConfigValue<string>('keil.uv4Path', '').trim());
    const candidates = [
      configured,
      'C:\\Keil_v5\\UV4\\UV4.exe',
      'C:\\Keil_v5\\UV4\\UV4',
    ].filter(Boolean);

    for (const item of candidates) {
      if (item && fs.existsSync(item)) {
        return item;
      }
    }

    throw new Error('Cannot find UV4 executable. Please configure serialagent.keil.uv4Path.');
  }

  private resolveJLinkExePath(): string {
    const configuredDir = stripWrappedQuotes(this.getConfigValue<string>('jlink.installDirectory', '').trim());
    if (configuredDir) {
      const byDir = path.join(configuredDir, process.platform === 'win32' ? 'JLink.exe' : 'JLinkExe');
      if (fs.existsSync(byDir)) {
        return byDir;
      }
    }

    const defaultPaths = process.platform === 'win32'
      ? [
        'C:\\Program Files\\SEGGER\\JLink\\JLink.exe',
        'C:\\Program Files (x86)\\SEGGER\\JLink\\JLink.exe',
      ]
      : ['/usr/bin/JLinkExe'];

    for (const p of defaultPaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    throw new Error('Cannot find JLink executable. Please configure serialagent.jlink.installDirectory.');
  }

  private async resolveProjectFile(): Promise<string> {
    const configured = stripWrappedQuotes(this.getConfigValue<string>('keil.projectFile', '').trim());
    if (configured) {
      const abs = path.isAbsolute(configured)
        ? configured
        : this.joinWorkspacePath(configured);
      if (abs && fs.existsSync(abs)) {
        return abs;
      }
      throw new Error(`Configured project file not found: ${abs}`);
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      throw new Error('No workspace folder opened.');
    }

    const matches = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folders[0], '**/*.{uvprojx,uvproj}'),
      '**/{node_modules,.git,_Reference}/**',
      20
    );

    if (!matches.length) {
      throw new Error('No .uvprojx/.uvproj file found. Please configure serialagent.keil.projectFile.');
    }

    const picked = matches[0].fsPath;
    this.output.appendLine(`[Keil] Auto-selected project: ${picked}`);
    return picked;
  }

  private parseUvprojx(projectFile: string): ProjectMeta {
    const xmlText = fs.readFileSync(projectFile, 'utf8');
    const targetBlocks = xmlText.match(/<Target>[\s\S]*?<\/Target>/g) || [];

    const targets = targetBlocks.map((block) => {
      const name = extractTag(block, 'TargetName') || 'Target 1';
      const outputDirectory = extractTag(block, 'OutputDirectory');
      const outputName = extractTag(block, 'OutputName');
      const deviceName = extractTag(block, 'Device');
      return { name, outputDirectory, outputName, deviceName };
    });

    return { targets };
  }

  private appendBuildLog(logFilePath: string): BuildLogSummary {
    if (!fs.existsSync(logFilePath)) {
      this.output.appendLine(`[Keil] Build log file not found: ${logFilePath}`);
      return { hasErrorKeyword: false };
    }

    const raw = fs.readFileSync(logFilePath, 'utf8');
    const lines = raw.split(/\r?\n/).map(line => line.trimEnd());
    this.output.appendLine(`[Keil] Build log: ${logFilePath}`);
    for (const line of lines) {
      if (line.length > 0) {
        this.output.appendLine(line);
      }
    }

    const highlights = lines.filter((line) =>
      /(\berror\b|\bfatal\b|\bwarning\b|Error:|compilation failed|build failed)/i.test(line)
    );
    if (highlights.length > 0) {
      this.output.appendLine('[Keil] Diagnostics Summary:');
      for (const row of highlights.slice(-30)) {
        this.output.appendLine(`  ${row}`);
      }
    }

    const finalSummary = this.extractBuildSummary(lines);
    return {
      errorCount: finalSummary?.errorCount,
      warningCount: finalSummary?.warningCount,
      hasErrorKeyword: lines.some((line) => /\berror\b|\bfatal\b/i.test(line)),
    };
  }

  private extractBuildSummary(lines: string[]): { errorCount: number; warningCount: number } | undefined {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      const match = /(\d+)\s+Error\(s\),\s+(\d+)\s+Warning\(s\)\.?/i.exec(line);
      if (match) {
        return {
          errorCount: parseInt(match[1], 10),
          warningCount: parseInt(match[2], 10),
        };
      }
    }
    return undefined;
  }

  private evaluateBuildResult(
    exitCode: number,
    logSummary: BuildLogSummary,
    artifactPath?: string
  ): { success: boolean; reason: string } {
    const resultPolicy = this.getConfigValue<string>('keil.resultPolicy', 'log-and-artifact').trim().toLowerCase();
    const strictExitCode = this.getConfigValue<boolean>('keil.strictExitCode', false) || resultPolicy === 'strict-exit-code';

    if (strictExitCode) {
      if (exitCode !== 0) {
        return { success: false, reason: `strict-exit-code policy enabled and UV4 exit code is ${exitCode}` };
      }
      return { success: true, reason: 'strict-exit-code policy passed (exit code is 0)' };
    }

    if (logSummary.errorCount !== undefined) {
      if (logSummary.errorCount > 0) {
        return { success: false, reason: `build log reports ${logSummary.errorCount} Error(s)` };
      }
      if (artifactPath) {
        return {
          success: true,
          reason: `build log reports 0 Error(s), ${logSummary.warningCount ?? 0} Warning(s), artifact exists`,
        };
      }
      return {
        success: false,
        reason: 'build log reports 0 Error(s), but no output artifact found',
      };
    }

    if (exitCode === 0 && artifactPath) {
      return { success: true, reason: 'exit code is 0 and artifact exists' };
    }

    if (artifactPath && !logSummary.hasErrorKeyword) {
      return { success: true, reason: 'artifact exists and no explicit error keyword found in build log' };
    }

    return {
      success: false,
      reason: `exit code ${exitCode}${artifactPath ? ', artifact exists but errors found in log' : ', and no artifact found'}`,
    };
  }

  private resolveTargetName(meta: ProjectMeta): string | undefined {
    const configuredTarget = this.getConfigValue<string>('keil.target', '').trim();
    if (configuredTarget) {
      const found = meta.targets.find(t => t.name === configuredTarget);
      if (!found) {
        const names = meta.targets.map(t => t.name).join(', ');
        throw new Error(`Target '${configuredTarget}' not found in project. Available: ${names}`);
      }
      return configuredTarget;
    }
    return meta.targets[0]?.name;
  }

  private resolveJLinkDevice(meta: ProjectMeta, targetName?: string): string {
    const configured = this.getConfigValue<string>('jlink.device', '').trim();
    if (configured) {
      return configured;
    }

    const target = meta.targets.find(t => t.name === targetName) || meta.targets[0];
    const fromProject = target?.deviceName?.trim();
    if (fromProject) {
      this.output.appendLine(`[JLink] Device from .uvprojx target: ${fromProject}`);
      return fromProject;
    }

    throw new Error('Missing JLink device name. Please configure serialagent.jlink.device, or set Device in .uvprojx target.');
  }

  private loadJLinkDeviceCandidates(meta: ProjectMeta, targetName?: string): JLinkDeviceCandidate[] {
    const map = new Map<string, JLinkDeviceCandidate>();

    const addCandidate = (cpuName: string, vendor: string | undefined, source: JLinkDeviceCandidate['source']) => {
      const key = cpuName.trim();
      if (!key) { return; }
      if (!map.has(key)) {
        map.set(key, { cpuName: key, vendor, source });
      }
    };

    const target = meta.targets.find(t => t.name === targetName) || meta.targets[0];
    if (target?.deviceName?.trim()) {
      addCandidate(target.deviceName.trim(), 'Keil Project', 'project');
    }
    for (const item of meta.targets) {
      if (item.deviceName?.trim()) {
        addCandidate(item.deviceName.trim(), `Target: ${item.name}`, 'project');
      }
    }

    for (const item of this.loadJLinkDevicesFromInstallDir()) {
      addCandidate(item.cpuName, item.vendor, 'jlink-db');
    }

    return Array.from(map.values()).sort((a, b) => a.cpuName.localeCompare(b.cpuName));
  }

  private loadJLinkDevicesFromInstallDir(): Array<{ cpuName: string; vendor?: string }> {
    try {
      const installDir = stripWrappedQuotes(this.getConfigValue<string>('jlink.installDirectory', '').trim());
      if (!installDir) { return []; }
      const dbFile = path.join(installDir, 'JLinkDevices.xml');
      if (!fs.existsSync(dbFile)) { return []; }
      const xmlText = fs.readFileSync(dbFile, 'utf8');
      return this.parseJLinkDeviceXml(xmlText);
    } catch {
      return [];
    }
  }

  private parseJLinkDeviceXml(xmlText: string): Array<{ cpuName: string; vendor?: string }> {
    const result: Array<{ cpuName: string; vendor?: string }> = [];
    const add = (cpuName: string | undefined, vendor?: string) => {
      if (!cpuName) { return; }
      const name = cpuName.trim();
      if (!name) { return; }
      if (!result.some(item => item.cpuName === name)) {
        result.push({ cpuName: name, vendor: vendor?.trim() || undefined });
      }
    };

    const vendorBlockRegex = /<VendorInfo[^>]*\bName="([^"]+)"[^>]*>([\s\S]*?)<\/VendorInfo>/gi;
    let vendorBlockMatch: RegExpExecArray | null;
    while ((vendorBlockMatch = vendorBlockRegex.exec(xmlText)) !== null) {
      const vendor = vendorBlockMatch[1];
      const block = vendorBlockMatch[2];
      const devRegex = /<DeviceInfo[^>]*\bName="([^"]+)"[^>]*\/?>(?:<\/DeviceInfo>)?/gi;
      let devMatch: RegExpExecArray | null;
      while ((devMatch = devRegex.exec(block)) !== null) {
        add(devMatch[1], vendor);
      }
    }

    const chipRegexA = /<ChipInfo[^>]*\bVendor="([^"]+)"[^>]*\bName="([^"]+)"[^>]*\/?>(?:<\/ChipInfo>)?/gi;
    let chipMatchA: RegExpExecArray | null;
    while ((chipMatchA = chipRegexA.exec(xmlText)) !== null) {
      add(chipMatchA[2], chipMatchA[1]);
    }

    const chipRegexB = /<ChipInfo[^>]*\bName="([^"]+)"[^>]*\bVendor="([^"]+)"[^>]*\/?>(?:<\/ChipInfo>)?/gi;
    let chipMatchB: RegExpExecArray | null;
    while ((chipMatchB = chipRegexB.exec(xmlText)) !== null) {
      add(chipMatchB[1], chipMatchB[2]);
    }

    return result;
  }

  private async resolveArtifact(projectFile: string, meta: ProjectMeta, targetName?: string): Promise<string> {
    const projectDir = path.dirname(projectFile);
    const target = meta.targets.find(t => t.name === targetName) || meta.targets[0];
    const outputName = target?.outputName?.trim();
    const outputDir = target?.outputDirectory?.trim();

    const candidates: string[] = [];
    if (outputName && outputDir) {
      candidates.push(path.resolve(projectDir, outputDir, `${outputName}.hex`));
      candidates.push(path.resolve(projectDir, outputDir, `${outputName}.axf`));
      candidates.push(path.resolve(projectDir, outputDir, `${outputName}.bin`));
    }

    if (outputName) {
      const roots = [projectDir, path.resolve(projectDir, 'build')];
      for (const root of roots) {
        candidates.push(path.resolve(root, `${outputName}.hex`));
        candidates.push(path.resolve(root, `${outputName}.axf`));
        candidates.push(path.resolve(root, `${outputName}.bin`));
      }
    }

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }

    const found = await this.findNewestArtifact(projectDir);
    if (!found) {
      throw new Error('No build artifact found (.hex/.axf/.bin). Please verify Keil output settings.');
    }
    return found;
  }

  private async findNewestArtifact(root: string): Promise<string | undefined> {
    const extList = ['hex', 'axf', 'bin'];
    const all: string[] = [];
    for (const ext of extList) {
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(root, `**/*.${ext}`),
        '**/{node_modules,.git,_Reference}/**',
        200
      );
      all.push(...files.map(f => f.fsPath));
    }

    if (!all.length) { return undefined; }

    all.sort((a, b) => {
      const aTime = fs.statSync(a).mtimeMs;
      const bTime = fs.statSync(b).mtimeMs;
      return bTime - aTime;
    });

    return all[0];
  }

  private joinWorkspacePath(relPath: string): string | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { return undefined; }
    return path.resolve(folder.uri.fsPath, relPath);
  }

  private runProcess(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env,
        shell: false,
        windowsHide: true,
      });

      child.stdout.on('data', (chunk: Buffer) => {
        this.output.append(chunk.toString());
      });
      child.stderr.on('data', (chunk: Buffer) => {
        this.output.append(chunk.toString());
      });
      child.on('error', (error) => {
        reject(error);
      });
      child.on('close', (code) => {
        resolve(code ?? -1);
      });
    });
  }
}
