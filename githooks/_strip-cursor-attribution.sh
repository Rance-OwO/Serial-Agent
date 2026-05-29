#!/bin/sh
# Remove Cursor commit attribution trailers injected by Cursor Agent / CLI.

strip_cursor_from_msg_file() {
	msg_file="$1"
	[ -n "$msg_file" ] || return 0
	[ -f "$msg_file" ] || return 0

	tmp="${msg_file}.cursor-strip.$$"
	grep -viE '^[[:space:]]*Co-authored-by:[[:space:]]*Cursor[[:space:]]*<cursoragent@cursor\.com>[[:space:]]*$' "$msg_file" |
		grep -viE '^[[:space:]]*Made-with:[[:space:]]*Cursor[[:space:]]*$' |
		grep -viE '^[[:space:]]*Made with Cursor[[:space:]]*$' >"$tmp" || true
	mv -f "$tmp" "$msg_file"
}