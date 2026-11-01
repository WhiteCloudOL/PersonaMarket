#!/bin/sh
set -eu
output=$1
mkdir -p "$(dirname "$output")"
printf 'Go toolchain\n' > "$output"
cat /usr/local/go/LICENSE >> "$output"
go list -m -f '{{if .Dir}}{{.Path}} {{.Version}} {{.Dir}}{{end}}' all | while read -r module version directory; do
  [ -n "$directory" ] || continue
  printf '\n\n===== %s %s =====\n' "$module" "$version" >> "$output"
  for file in "$directory"/LICENSE* "$directory"/LICENCE* "$directory"/NOTICE* "$directory"/COPYING*; do
    [ -f "$file" ] || continue
    printf '\n%s\n' "$(basename "$file")" >> "$output"
    cat "$file" >> "$output"
  done
done
