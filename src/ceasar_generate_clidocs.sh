#!/bin/bash

for file in /usr/local/ceasar/bin/*; do
	echo "$file" >> ~/ceasar_cli_help.txt
	[ -f "$file" ] && [ -x "$file" ] && "$file" >> ~/ceasar_cli_help.txt
done

sed -i 's\/usr/local/ceasar/bin/\\' ~/ceasar_cli_help.txt
