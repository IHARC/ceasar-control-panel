#!/bin/bash

#===========================================================================#
#                                                                           #
# Ceasar Control Panel - Backup Function Library                            #
#                                                                           #
#===========================================================================#

# Restic init refuses an existing repository. Use that maintained command
# contract after a failed read instead of interpreting backend-specific errors:
# it creates a missing repository while rejecting wrong keys, connectivity
# failures, and an existing corrupt configuration without overwriting it.
ensure_restic_repository() {
	local repository=$1
	local password_file=$2

	if restic --repo "$repository" --password-file "$password_file" cat config > /dev/null; then
		return 0
	fi

	restic --repo "$repository" --password-file "$password_file" init
}

# Resolve the web template that is actually selected for a backup. Most
# PHP-FPM templates live below php-fpm/, but installation-specific templates
# such as IHARC's own Apache template intentionally live at the web-server
# root and provide their FastCGI handler themselves. Require the complete
# template pair so an incomplete installation fails the backup visibly.
backup_web_template_dir() {
	local web_system=$1
	local web_backend=$2
	local template=$3
	local template_root="$WEBTPL/$web_system"

	if [ "$web_backend" = 'php-fpm' ] \
		&& [ -f "$template_root/php-fpm/$template.tpl" ] \
		&& [ -f "$template_root/php-fpm/$template.stpl" ]; then
		printf '%s\n' "$template_root/php-fpm"
		return 0
	fi

	if [ -f "$template_root/$template.tpl" ] && [ -f "$template_root/$template.stpl" ]; then
		printf '%s\n' "$template_root"
		return 0
	fi

	return 1
}

# Local storage
# Defining local storage function
local_backup() {

	rm -f $BACKUP/$user.$backup_new_date.tar

	# Checking retention
	backup_list=$(ls -lrt $BACKUP/ | awk '{print $9}' | grep -E "^${user}\.[0-9]{4}-.+\.tar$" | sort)
	backups_count=$(echo "$backup_list" | wc -l)
	if [ "$BACKUPS" -le "$backups_count" ]; then
		backups_rm_number=$((backups_count - BACKUPS + 1))

		# Removing old backup
		for backup in $(echo "$backup_list" | head -n $backups_rm_number); do
			backup_date=$(echo $backup | sed -e "s/$user.//" -e "s/.tar$//")
			echo -e "$(date "+%F %T") Rotated: $backup_date" \
				| tee -a $BACKUP/$user.log
			rm -f $BACKUP/$backup
		done
	fi

	# Checking disk space
	disk_usage=$(df $BACKUP | tail -n1 | tr ' ' '\n' | grep % | cut -f 1 -d %)
	if [ "$disk_usage" -ge "$BACKUP_DISK_LIMIT" ]; then
		rm -rf $tmpdir
		rm -f $BACKUP/$user.log
		sed -i "/ $user /d" $CEASAR/data/queue/backup.pipe
		echo "Not enough disk space" | $SENDMAIL -s "$subj" "$email" "yes"
		check_result "$E_DISK" "Not enough dsk space"
	fi

	# Creating final tarball
	cd $tmpdir
	tar -cf $BACKUP/$user.$backup_new_date.tar .
	chmod 640 $BACKUP/$user.$backup_new_date.tar
	chown "ceasarweb":"$user" $BACKUP/$user.$backup_new_date.tar
	localbackup='yes'
	echo -e "$(date "+%F %T") Local: $BACKUP/$user.$backup_new_date.tar" \
		| tee -a $BACKUP/$user.log
}

# FTP Functions
# Defining ftp command function
ftpc() {
	/usr/bin/ftp -np $HOST $PORT << EOF
    quote USER $USERNAME
    quote PASS $PASSWORD
    binary
    $1
    $2
    $3
    quit
EOF
}

# Defining ftp storage function
ftp_backup() {
	# Checking config
	if [ ! -e "$CEASAR/conf/ftp.backup.conf" ]; then
		error="ftp.backup.conf doesn't exist"
		echo "$error" | $SENDMAIL -s "$subj" $email "yes"
		sed -i "/ $user /d" $CEASAR/data/queue/backup.pipe
		echo "$error"
		errorcode="$E_NOTEXIST"
		return "$E_NOTEXIST"
	fi

	# Parse config
	source_conf "$CEASAR/conf/ftp.backup.conf"

	# Set default port
	if [ -z "$(grep 'PORT=' $CEASAR/conf/ftp.backup.conf)" ]; then
		PORT='21'
	fi

	# Checking variables
	if [ -z "$HOST" ] || [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
		error="Can't parse ftp backup configuration"
		echo "$error" | $SENDMAIL -s "$subj" $email "yes"
		sed -i "/ $user /d" $CEASAR/data/queue/backup.pipe
		echo "$error"
		errorcode="$E_PARSING"
		return "$E_PARSING"
	fi

	# Debug info
	echo -e "$(date "+%F %T") Remote: ftp://$HOST$BPATH/$user.$backup_new_date.tar"

	# Checking ftp connection
	fconn=$(ftpc)
	ferror=$(echo $fconn | grep -i -e failed -e error -e "Can't" -e "not conn")
	if [ -n "$ferror" ]; then
		error="Error: can't login to ftp ftp://$USERNAME@$HOST"
		echo "$error" | $SENDMAIL -s "$subj" $email $notify
		sed -i "/ $user /d" $CEASAR/data/queue/backup.pipe
		echo "$error"
		errorcode="$E_CONNECT"
		return "$E_CONNECT"
	fi

	# Check ftp permissions
	if [ -z $BPATH ]; then
		ftmpdir="vst.bK76A9SUkt"
	else
		ftpc "mkdir $BPATH" > /dev/null 2>&1
		ftmpdir="$BPATH/vst.bK76A9SUkt"
	fi
	ftpc "mkdir $ftmpdir" "rm $ftmpdir"
	ftp_result=$(ftpc "mkdir $ftmpdir" "rm $ftmpdir" | grep -v Trying)
	if [ -n "$ftp_result" ]; then
		error="Can't create ftp backup folder ftp://$HOST$BPATH"
		echo "$error" | $SENDMAIL -s "$subj" $email $notify
		sed -i "/ $user /d" $CEASAR/data/queue/backup.pipe
		echo "$error"
		errorcode="$E_FTP"
		return "$E_FTP"
	fi

	# Checking retention (Only include .tar files)
	if [ -z $BPATH ]; then
		backup_list=$(ftpc "ls" | awk '{print $9}' | grep -E "^${user}\.[0-9]{4}-.+\.tar$" | sort)
	else
		backup_list=$(ftpc "cd $BPATH" "ls" | awk '{print $9}' | grep -E "^${user}\.[0-9]{4}-.+\.tar$" | sort)
	fi
	backups_count=$(echo "$backup_list" | wc -l)
	if [ "$backups_count" -ge "$BACKUPS" ]; then
		backups_rm_number=$((backups_count - BACKUPS + 1))
		for backup in $(echo "$backup_list" | head -n $backups_rm_number); do
			backup_date=$(echo $backup | sed -e "s/$user.//" -e "s/.tar$//")
			echo -e "$(date "+%F %T") Rotated ftp backup: $backup_date" \
				| tee -a $BACKUP/$user.log
			if [ -z $BPATH ]; then
				ftpc "delete $backup"
			else
				ftpc "cd $BPATH" "delete $backup"
			fi
		done
	fi

	# Uploading backup archive
	if [ "$localbackup" = 'yes' ]; then
		cd $BACKUP
		if [ -z $BPATH ]; then
			ftpc "put $user.$backup_new_date.tar"
		else
			ftpc "cd $BPATH" "put $user.$backup_new_date.tar"
		fi
	else
		cd $tmpdir
		tar -cf $BACKUP/$user.$backup_new_date.tar .
		cd $BACKUP/
		if [ -z $BPATH ]; then
			ftpc "put $user.$backup_new_date.tar"
		else
			ftpc "cd $BPATH" "put $user.$backup_new_date.tar"
		fi
		rm -f $user.$backup_new_date.tar
	fi
}

# FTP backup download function
ftp_download() {
	source_conf "$CEASAR/conf/ftp.backup.conf"
	if [ -z "$PORT" ]; then
		PORT='21'
	fi
	cd $BACKUP
	if [ -z $BPATH ]; then
		ftpc "get $1"
	else
		ftpc "cd $BPATH" "get $1"
	fi
}

#FTP Delete function
ftp_delete() {
	source_conf "$CEASAR/conf/ftp.backup.conf"
	if [ -z "$PORT" ]; then
		PORT='21'
	fi
	if [ -z $BPATH ]; then
		ftpc "delete $1"
	else
		ftpc "cd $BPATH" "delete $1"
	fi
}

# SFTP Functions
# sftp command function
sftpc() {
	if [ "$PRIVATEKEY" != "yes" ]; then
		expect -f "-" "$@" << EOF
            set timeout 60
            set count 0
            spawn /usr/bin/sftp -o StrictHostKeyChecking=no \
                -o Port=$PORT $USERNAME@$HOST
            expect {
                -nocase "password:" {
                    send "$PASSWORD\r"
                    exp_continue
                }

                -re "Password for (.*)@(.*)" {
                    send "$PASSWORD\r"
                    exp_continue
                }

                -re "Couldn't|(.*)disconnect|(.*)stalled|(.*)not found" {
                    set count \$argc
                    set output "Disconnected."
                    set rc $E_FTP
                    exp_continue
                }

                -re ".*denied.*(publickey|password)." {
                    set output "Permission denied, wrong publickey or password."
                    set rc $E_CONNECT
                }

                -re "\[0-9]*%" {
                    exp_continue
                }

                "sftp>" {
                    if {\$count < \$argc} {
                        set arg [lindex \$argv \$count]
                        send "\$arg\r"
                        incr count
                    } else {
                        send "exit\r"
                        set output "Disconnected."
                        if {[info exists rc] != 1} {
                            set rc $OK
                        }
                    }
                    exp_continue
                }

                timeout {
                    set output "Connection timeout."
                    set rc $E_CONNECT
                }
            }

            if {[info exists output] == 1} {
                puts "\$output"
            }

        exit \$rc
EOF
	else

		expect -f "-" "$@" << EOF
            set timeout 60
            set count 0
            spawn /usr/bin/sftp -o StrictHostKeyChecking=no \
                -o Port=$PORT -i $PASSWORD $USERNAME@$HOST
            expect {
                -nocase "password:" {
                    send "$PASSWORD\r"
                    exp_continue
                }

                -re "Couldn't|(.*)disconnect|(.*)stalled|(.*)not found" {
                    set count \$argc
                    set output "Disconnected."
                    set rc $E_FTP
                    exp_continue
                }

                -re ".*denied.*(publickey|password)." {
                    set output "Permission denied, wrong publickey or password."
                    set rc $E_CONNECT
                }

                -re "\[0-9]*%" {
                    exp_continue
                }

                "sftp>" {
                    if {\$count < \$argc} {
                        set arg [lindex \$argv \$count]
                        send "\$arg\r"
                        incr count
                    } else {
                        send "exit\r"
                        set output "Disconnected."
                        if {[info exists rc] != 1} {
                            set rc $OK
                        }
                    }
                    exp_continue
                }

                timeout {
                    set output "Connection timeout."
                    set rc $E_CONNECT
                }
            }

            if {[info exists output] == 1} {
                puts "\$output"
            }

        exit \$rc
EOF

	fi
}

# SFTP backup download function
sftp_download() {
	source_conf "$CEASAR/conf/sftp.backup.conf"
	if [ -z "$PORT" ]; then
		PORT='22'
	fi
	cd $BACKUP
	if [ -z $BPATH ]; then
		sftpc "get $1" > /dev/null 2>&1
	else
		sftpc "cd $BPATH" "get $1" > /dev/null 2>&1
	fi
}

sftp_delete() {
	echo "$1"
	source_conf "$CEASAR/conf/sftp.backup.conf"
	if [ -z "$PORT" ]; then
		PORT='22'
	fi
	echo $BPATH
	if [ -z $BPATH ]; then
		sftpc "rm $1" > /dev/null 2>&1
	else
		sftpc "cd $BPATH" "rm $1" > /dev/null 2>&1
	fi

}

sftp_backup() {
	# Checking config
	if [ ! -e "$CEASAR/conf/sftp.backup.conf" ]; then
		error="Can't open sftp.backup.conf"
		echo "$error" | $SENDMAIL -s "$subj" $email "yes"
		sed -i "/ $user /d" $CEASAR/data/queue/backup.pipe
		echo "$error"
		errorcode="$E_NOTEXIST"
		return "$E_NOTEXIST"
	fi

	# Parse config
	source_conf "$CEASAR/conf/sftp.backup.conf"

	# Set default port
	if [ -z "$(grep 'PORT=' $CEASAR/conf/sftp.backup.conf)" ]; then
		PORT='22'
	fi

	# Checking variables
	if [ -z "$HOST" ] || [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
		error="Can't parse sftp backup configuration"
		echo "$error" | $SENDMAIL -s "$subj" $email "yes"
		sed -i "/ $user /d" $CEASAR/data/queue/backup.pipe
		echo "$error"
		errorcode="$E_PARSING"
		return "$E_PARSING"
	fi

	# Debug info
	echo -e "$(date "+%F %T") Remote: sftp://$HOST/$BPATH/$user.$backup_new_date.tar" \
		| tee -a $BACKUP/$user.log

	# Checking network connection and write permissions
	if [ -z $BPATH ]; then
		sftmpdir="vst.bK76A9SUkt"
	else
		sftmpdir="$BPATH/vst.bK76A9SUkt"
	fi
	sftpc "mkdir $BPATH" > /dev/null 2>&1
	sftpc "mkdir $sftmpdir" "rmdir $sftmpdir" > /dev/null 2>&1
	rc=$?
	if [[ "$rc" != 0 ]]; then
		case $rc in
			$E_CONNECT) error="Can't login to sftp host $HOST" ;;
			$E_FTP) error="Can't create temp folder on sftp $HOST" ;;
		esac
		echo "$error" | $SENDMAIL -s "$subj" $email "yes"
		sed -i "/ $user /d" $CEASAR/data/queue/backup.pipe
		echo "$error"
		errorcode="$rc"
		return "$rc"
	fi

	# Checking retention (Only include .tar files)
	if [ -z $BPATH ]; then
		backup_list=$(sftpc "ls -l" | tr -d '\r' | awk '{print $9}' | grep -E "^${user}\.[0-9]{4}-.+\.tar$" | sort)
	else
		backup_list=$(sftpc "cd $BPATH" "ls -l" | tr -d '\r' | awk '{print $9}' | grep -E "^${user}\.[0-9]{4}-.+\.tar$" | sort)
	fi
	if [ -z "$backup_list" ]; then
		backups_count=0
	else
		backups_count=$(echo "$backup_list" | wc -l)
	fi
	if [ "$backups_count" -ge "$BACKUPS" ]; then
		backups_rm_number=$((backups_count - BACKUPS + 1))
		for backup in $(echo "$backup_list" | head -n $backups_rm_number); do
			backup_date=$(echo $backup | sed -e "s/$user.//" -e "s/.tar.*$//")
			echo -e "$(date "+%F %T") Rotated sftp backup: $backup_date" \
				| tee -a $BACKUP/$user.log
			if [ -z $BPATH ]; then
				sftpc "rm $backup" > /dev/null 2>&1
			else
				sftpc "cd $BPATH" "rm $backup" > /dev/null 2>&1
			fi
		done
	fi

	# Uploading backup archive
	echo "$(date "+%F %T") Uploading $user.$backup_new_date.tar" | tee -a $BACKUP/$user.log
	if [ "$localbackup" = 'yes' ]; then
		cd $BACKUP
		if [ -z $BPATH ]; then
			sftpc "put $user.$backup_new_date.tar" "chmod 0600 $user.$backup_new_date.tar" > /dev/null 2>&1
		else
			sftpc "cd $BPATH" "put $user.$backup_new_date.tar" "chmod 0600 $user.$backup_new_date.tar" > /dev/null 2>&1
		fi
	else
		cd $tmpdir
		tar -cf $BACKUP/$user.$backup_new_date.tar .
		cd $BACKUP/
		if [ -z $BPATH ]; then
			sftpc "put $user.$backup_new_date.tar" "chmod 0600 $user.$backup_new_date.tar" > /dev/null 2>&1
		else
			sftpc "cd $BPATH" "put $user.$backup_new_date.tar" "chmod 0600 $user.$backup_new_date.tar" > /dev/null 2>&1
		fi
		rm -f $user.$backup_new_date.tar
	fi
}

# BackBlaze B2 backup function
b2_backup() {
	# Defining backblaze b2 settings
	source_conf "$CEASAR/conf/b2.backup.conf"

	# Recreate backblaze auth file ~/.b2_account_info (for situation when key was changed in b2.backup.conf)
	b2 clear-account > /dev/null 2>&1
	b2 authorize-account $B2_KEYID $B2_KEY > /dev/null 2>&1

	# Uploading backup archive
	echo -e "$(date "+%F %T") Upload to B2: $user/$user.$backup_new_date.tar"
	if [ "$localbackup" = 'yes' ]; then
		cd $BACKUP
		b2 upload-file $BUCKET $user.$backup_new_date.tar $user/$user.$backup_new_date.tar > /dev/null 2>&1
	else
		cd $tmpdir
		tar -cf $BACKUP/$user.$backup_new_date.tar .
		cd $BACKUP/
		b2 upload-file $BUCKET $user.$backup_new_date.tar $user/$user.$backup_new_date.tar > /dev/null 2>&1
		rc=$?
		rm -f $user.$backup_new_date.tar
		if [ "$rc" -ne 0 ]; then
			check_result "$E_CONNECT" "b2 failed to upload $user.$backup_new_date.tar"
		fi
	fi

	# Checking retention
	backup_list=$(b2 ls --long $BUCKET $user | cut -f 1 -d ' ' 2> /dev/null)
	backups_count=$(echo "$backup_list" | wc -l)
	if [ "$backups_count" -ge "$BACKUPS" ]; then
		backups_rm_number=$(($backups_count - $BACKUPS))
		for backup in $(echo "$backup_list" | head -n $backups_rm_number); do
			backup_file_name=$(b2 get-file-info $backup | grep fileName | cut -f 4 -d '"' 2> /dev/null)
			echo -e "$(date "+%F %T") Rotated b2 backup: $backup_file_name"
			b2 delete-file-version $backup > /dev/null 2>&1
		done
	fi

}

b2_download() {
	# Defining backblaze b2 settings
	source_conf "$CEASAR/conf/b2.backup.conf"

	# Recreate backblaze auth file ~/.b2_account_info (for situation when key was changed in b2.backup.conf)
	b2 clear-account > /dev/null 2>&1
	b2 authorize-account $B2_KEYID $B2_KEY > /dev/null 2>&1
	cd $BACKUP
	b2 download-file-by-name $BUCKET $user/$1 $1 > /dev/null 2>&1
	if [ "$?" -ne 0 ]; then
		check_result "$E_CONNECT" "b2 failed to download $user.$1"
	fi
}

b2_delete() {
	# Defining backblaze b2 settings
	source_conf "$CEASAR/conf/b2.backup.conf"

	# Recreate backblaze auth file ~/.b2_account_info (for situation when key was changed in b2.backup.conf)
	b2 clear-account > /dev/null 2>&1
	b2 authorize-account $B2_KEYID $B2_KEY > /dev/null 2>&1

	b2 delete-file-version $1/$2 > /dev/null 2>&1
}

rclone_backup() {
	# Keep the staging archive until the remote object is confirmed complete.
	source_conf "$CEASAR/conf/rclone.backup.conf"
	local archive="$user.$backup_new_date.tar" destination="$HOST:${BPATH%/}"
	local listing remote_size local_size backups_rm_number old_backup
	if [ "$localbackup" != 'yes' ]; then
		(
			umask 077
			tar -cf "$BACKUP/$archive" -C "$tmpdir" .
		)
		check_result $? "Unable to create backup archive"
	fi
	rclone copyto "$BACKUP/$archive" "$destination/$archive"
	check_result $? "Unable to upload backup"
	remote_size=$(rclone lsjson --stat "$destination/$archive")
	check_result $? "Unable to verify uploaded backup"
	remote_size=$(printf '%s' "$remote_size" | jq -er 'select(.IsDir == false) | .Size')
	check_result $? "Invalid uploaded backup metadata"
	local_size=$(stat -c %s "$BACKUP/$archive")
	check_result $? "Unable to inspect backup archive"
	[[ "$remote_size" == "$local_size" ]] || check_result "$E_CONNECT" "Uploaded backup size does not match"
	listing=$(rclone lsf --files-only "$destination")
	check_result $? "Unable to list remote backups"
	backup_list=$(printf '%s\n' "$listing" | grep -E "^${user}\.[0-9]{4}-.+\.tar$" | sort)
	backups_count=$(printf '%s\n' "$backup_list" | grep -c .)
	backups_rm_number=$((backups_count - BACKUPS))
	if [ "$backups_rm_number" -gt 0 ]; then
		while IFS= read -r old_backup; do
			rclone deletefile "$destination/$old_backup"
			check_result $? "Unable to remove expired remote backup"
		done < <(printf '%s\n' "$backup_list" | head -n "$backups_rm_number")
	fi
	if [ "$localbackup" != 'yes' ]; then
		rm -f -- "$BACKUP/$archive"
		check_result $? "Unable to remove uploaded staging archive"
	fi
}

rclone_delete() {
	# Defining rclone settings
	source_conf "$CEASAR/conf/rclone.backup.conf"
	rclone deletefile "$HOST:${BPATH%/}/$1"
	check_result $? "Unable to delete remote backup"
}

rclone_download() {

	# A failed download must not be presented to restore as a complete archive.
	source_conf "$CEASAR/conf/rclone.backup.conf"
	local partial
	partial=$(mktemp "$BACKUP/.restore.XXXXXX")
	check_result $? "Unable to create restore staging file"
	if ! rclone copyto "$HOST:${BPATH%/}/$1" "$partial"; then
		rm -f -- "$partial"
		check_result "$E_CONNECT" "Unable to download backup"
	fi
	if ! mv -- "$partial" "$BACKUP/$1"; then
		rm -f -- "$partial"
		check_result "$E_CONNECT" "Unable to publish downloaded backup"
	fi
}
