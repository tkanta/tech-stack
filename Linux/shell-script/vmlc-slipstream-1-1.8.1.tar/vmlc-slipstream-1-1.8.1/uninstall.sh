#!/bin/bash

###########################################################################################
#
# (c) Copyright 2022 TeleCommunication Systems, Inc., a wholly-owned subsidiary
# of Comtech TeleCommunications Corp. and/or affiliates of TeleCommunication Systems, Inc.
# PROPRIETARY/CONFIDENTIAL. Use is subject to license terms.
# ALL RIGHTS RESERVED
#
# The software and information contained herein are proprietary to, and
# comprise valuable trade secrets of, TeleCommunication Systems, Inc., which
# intends to preserve as trade secrets such software and information.
# This software is furnished pursuant to a written license agreement and
# may be used, copied, transmitted, and stored only in accordance with
# the terms of such license and with the inclusion of the above copyright
# notice.  This software and information or any other copies thereof may
# not be provided or otherwise made available to any other person.
#
###########################################################################################

ssId=1.8.1_slipstream_1
ssNodes="config service1 service2"
USER=""
PASS=""

##
# Show the usage commands for this script
##
usage()
{
	EXIT_CODE=$1
	echo "usage: $0 -u <username> -p <password>"
	echo "	   -u <username> username required for DataAccess authentication"
	echo "	   -p <password> password required for DataAccess authentication"
	echo "	   -h help"
	exit $EXIT_CODE
}

checkInputValues()
{
	# Process command line arguments
	while getopts u:p:h opt
	do
	case "$opt" in
		"u")
		USER="$OPTARG"
		;;
		"p")
		PASS="$OPTARG"
		;;
		"h")
		usage 1
		;;
		*)
		echo "$0: Invalid option -- $opt" >&2
		usage 2
		;;
	esac
	done

	if [ "$PASS" = "" ] || [ "$USER" = "" ]; then
		echo "Username and password required"
		usage 3
	fi
}

remove_files()
{
	echo "$(date -u) Removing slipstream files from $1 (if present)"
	ssh -q $1 "sudo rm -f /opt/LC/current/bin/applyClsPrivileges.sh"
	ssh -q $1 "sudo rm -f /opt/LC/current/bin/removeClsPrivileges.sh"
	ssh -q $1 "sudo rm -f /opt/LC/current/ngls/dascripts/upgrade/add-mlcdauser-cls-privileges.das"
	ssh -q $1 "sudo rm -f /opt/LC/current/ngls/dascripts/upgrade/rollback-mlcdauser-cls-privileges.das"
	ssh -q $1 "sudo rm -f /opt/LC/current/ngls/dascripts/upgrade/verify-mlcdauser-cls-privileges.das"
}

remove_da_update()
{
	if [ ! -f /opt/LC/current/bin/removeClsPrivileges.sh ]; then
		echo "$(date -u) WARNING: Slipstream files not found. Skipping cls privilege removal."
		exit_status=0
	else
		ssh -q service1 "netstat -an |grep 8081" > /dev/null 2>&1
		if [ $? -ne 0 ]; then
			echo "$(date -u) WARNING: DA not running. cls privilege not removed as E-SMLC not deployed."
			exit_status=0
		else
			echo "$(date -u) Removing DA update"
			/opt/LC/current/bin/removeClsPrivileges.sh -u $USER -p $PASS
			exit_status=$?
			if [ ${exit_status} -eq 0 ]; then
				echo "$(date -u) Successfully removed cls privilege"
			else
				echo "$(date -u) DA removal FAILED"
			fi
		fi
	fi
	return ${exit_status}
}

### MAIN ###
checkInputValues $@

remove_da_update
exit_status=$?

if [ ${exit_status} -eq 0 ]; then
	for host in ${ssNodes}; do
		remove_files ${host}
		(( exit_status |= $? ))
	done
fi

echo "=== Removal of ${ssId} from ${ssNodes} is complete ==="
echo "=== Exit Code = ${exit_status} ==="

exit ${exitStatus}

