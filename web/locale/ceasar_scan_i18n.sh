#!/bin/bash

if [ ! -x /usr/bin/xgettext ]; then
	echo " **********************************************************"
	echo " * Unable to find xgettext please install gettext package *"
	echo " **********************************************************"
	exit 3
fi

echo "[ * ] Move ceasar.pot to ceasar.pot.old"
mv ceasar.pot ceasar.pot.old
true > ceasar.pot

echo "[ * ] Search *.php *.html and *.sh for php based gettext functions"
find ../.. \( -name '*.php' -o -name '*.html' -o -name '*.sh' \) | xgettext --output=ceasar.pot --language=PHP --join-existing -f -

# Scan the description string for list updates page
while IFS= read -r string; do
	if ! grep -q "\"$string\"" ceasar.pot; then
		echo -e "\n#: ../../bin/v-list-sys-ceasar-updates:$(grep -n "$string" ../../bin/v-list-sys-ceasar-updates | cut -d: -f1)\nmsgid \"$string\"\nmsgstr \"\"" >> ceasar.pot
	fi
done < <(awk -F'DESCR=' '/data=".+ DESCR=[^"]/ {print $2}' ../../bin/v-list-sys-ceasar-updates | cut -d\' -f2)

# Scan the description string for list server page
while IFS= read -r string; do
	if ! grep -q "\"$string\"" ceasar.pot; then
		echo -e "\n#: ../../bin/v-list-sys-services:$(grep -n "$string" ../../bin/v-list-sys-services | cut -d: -f1)\nmsgid \"$string\"\nmsgstr \"\"" >> ceasar.pot
	fi
done < <(awk -F'SYSTEM=' '/data=".+ SYSTEM=[^"]/ {print $2}' ../../bin/v-list-sys-services | cut -d\' -f2)

# Prevent only date change become a commit
if [ "$(diff ceasar.pot ceasar.pot.old | wc -l)" -gt 4 ]; then
	rm ceasar.pot.old
else
	mv -f ceasar.pot.old ceasar.pot
fi
