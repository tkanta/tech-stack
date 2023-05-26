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

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
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

copy_files()
{
	echo "$(date -u) Copying slipstream files to $1"
	ssh -q $1 "mkdir /tmp/${ssId}"
	scp -q ${SCRIPT_DIR}/* $1:/tmp/${ssId} > /dev/null
	ssh -q $1 "sudo cp /tmp/${ssId}/applyClsPrivileges.sh /opt/LC/current/bin"
	ssh -q $1 "sudo cp /tmp/${ssId}/removeClsPrivileges.sh /opt/LC/current/bin"
	ssh -q $1 "sudo cp /tmp/${ssId}/add-mlcdauser-cls-privileges.das /opt/LC/current/ngls/dascripts/upgrade"
	ssh -q $1 "sudo cp /tmp/${ssId}/rollback-mlcdauser-cls-privileges.das /opt/LC/current/ngls/dascripts/upgrade"
	ssh -q $1 "sudo cp /tmp/${ssId}/verify-mlcdauser-cls-privileges.das /opt/LC/current/ngls/dascripts/upgrade"
	ssh -q $1 "rm -rf /tmp/${ssId}"
	ssh -q $1 "sudo chown emob:mlc /opt/LC/current/bin/applyClsPrivileges.sh"
	ssh -q $1 "sudo chown emob:mlc /opt/LC/current/bin/removeClsPrivileges.sh"
	ssh -q $1 "sudo chown emob:mlc /opt/LC/current/ngls/dascripts/upgrade/*.das"
	ssh -q $1 "sudo chmod 555 /opt/LC/current/bin/applyClsPrivileges.sh"
	ssh -q $1 "sudo chmod 555 /opt/LC/current/bin/removeClsPrivileges.sh"
	ssh -q $1 "sudo chmod 444 /opt/LC/current/ngls/dascripts/upgrade/*.das"
}

apply_da_update()
{
	ssh -q service1 "netstat -an |grep 8081" > /dev/null 2>&1
	if [ $? -ne 0 ]; then
		echo "$(date -u) WARNING: DA not running. cls privilege not added as E-SMLC not deployed."
		exit_status=0
	else
		echo "$(date -u) Applying DA update"
		/opt/LC/current/bin/applyClsPrivileges.sh -u $USER -p $PASS
		exit_status=$?
		if [ ${exit_status} -eq 0 ]; then
			echo "$(date -u) Successfully added cls privilege."
		else
			echo "$(date -u) DA application FAILED"
		fi
	fi
	return ${exit_status}
}

### MAIN ###
checkInputValues $@

echo "=== Applying ${ssId} to ${ssNodes} ==="
exit_status=0
for host in ${ssNodes}; do
	copy_files ${host}
	(( exit_status |= $? ))
done

if [ ${exit_status} -eq 0 ]; then
	apply_da_update
	(( exit_status |= $? ))
fi

echo "=== Application of ${ssId} to ${ssNodes} is complete ==="
echo "=== Exit Code = ${exit_status} ==="

exit ${exitStatus}
story

