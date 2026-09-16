#!/bin/bash
if [ ! -e /usr/bin/xgettext ]; then
	echo " **********************************************************"
	echo " * Unable to find xgettext please install gettext package *"
	echo " **********************************************************"
	exit 3
fi

lang=${1-all}

if [ "$lang" == "all" ]; then
	languages=$(ls -d "$CEASAR/web/locale/*/" | awk -F'/' '{print $(NF-1)}')
	for lang in $languages; do
		echo "[ * ] Update $lang "
		msgfmt "$CEASAR/web/locale/$lang/LC_MESSAGES/ceasar.po" -o "$CEASAR/web/locale/$lang/LC_MESSAGES/ceasar.mo"
	done
else
	echo "[ * ] Update $lang "
	msgfmt "$CEASAR/web/locale/$lang/LC_MESSAGES/ceasar.po" -o "$CEASAR/web/locale/$lang/LC_MESSAGES/ceasar.mo"
fi
