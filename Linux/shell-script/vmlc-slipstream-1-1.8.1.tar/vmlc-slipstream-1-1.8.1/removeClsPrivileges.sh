#!/bin/bash
# (c) Copyright 2022 TeleCommunication Systems, Inc., a wholly-owned 
# subsidiary of Comtech TeleCommunications Corp. and/or affiliates of 
# TeleCommunication Systems, Inc.
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
# This script performs steps necessary to commit an upgraded MLC system to the new version.
# Once this script has been run, the system can no longer be rolled back.
#
. `dirname $0`/../bin/commonFunctions.sh

enforceUserToRunCommandWith centos "$@"

USER=""
PASS=""
DA_CHECK=/opt/LC/current/ngls/dascripts/upgrade/verify-mlcdauser-cls-privileges.das
DA_UPDATE=/opt/LC/current/ngls/dascripts/upgrade/rollback-mlcdauser-cls-privileges.das
DA_RUNNER=/opt/LC/current/ngls/dascriptrunner.sh
DAHOST=`determineHostDomainNameFromPUClass LS1`
UPDATE=true

##
# Show the usage commands for this script
##
usage()
{
    EXIT_CODE=$1
    echo "usage: $0 -u <username> -p <password>"
    echo "       -u <username> username required for DataAccess authentication"
    echo "       -p <password> password required for DataAccess authentication"
    echo "       -c only check to see if the DB update has already been made"
    echo "       -h help"
    exit $EXIT_CODE
}

checkInputValues()
{
    # Process command line arguments
    while getopts u:p:hc opt
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
        "c")
        UPDATE=false
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

# 
# Check to see if the database is already at the desired state
# Extra detail of checking for the actual error type is to ensure the problem
# isn't just with user credentials, actually verify we don't find the 
# access network that contains the clsldf index.
verifyUpdateRequired()
{
    ssh -q $DAHOST "$DA_RUNNER $DA_CHECK -u $USER -p $PASS" > /tmp/$$-output 2>&1
    if [ $? -ne 0 ];
    then
        echo "Database content already does not include cls privilege"
        rm -f /tmp/$$-output
        exit 0
    fi
    
    echo "Database is ready to be updated to remove cls privilege"
    
    rm -f /tmp/$$-output
}

#
# Perform the necessary updates to the database to bring this
# system in line with the vMLC 1.8.0 baseline installation
updateDBContent()
{
    echo "Updating the the database to remove cls privilege"
    ssh $DAHOST "$DA_RUNNER $DA_UPDATE -u $USER -p $PASS"
    if [ $? -ne 0 ];
    then
        echo "DATABASE UPDATE HAS FAILED"
        exit 6
    fi
    echo "Database updated successfully"
}
### MAIN ###

checkInputValues $@
verifyUpdateRequired

[[ $UPDATE == true ]] && updateDBContent || echo "NO CHANGES MADE: Not making updates to the DB due to check only option being selected"

exit 0
