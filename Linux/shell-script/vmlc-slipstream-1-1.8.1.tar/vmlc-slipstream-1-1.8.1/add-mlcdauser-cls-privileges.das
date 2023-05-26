# ---------------------------------------------------------
# This script updates the Network Engineer role to add all the required privileges (including cls and dbh)
# To be run following the upgrade to 1.8.0 and the execution of the upgradeCommit.sh script.
# If there were any changes to the network engineer role that deviated from the default required for 1.8, then these changes will be lost.
# ---------------------------------------------------------

SCRIPT_VERSION: 1

# root document
COMMAND_ID: root-document
RESOURCE_URL: /
HTTP_METHOD: GET
CONTENT_TYPE: text/xml
VERSION: 1
VARS:
  @COMMAND_ID@.userauthz-index-uri: XPATH(//root:index[@type="userauthz"]/text())
END_VARS:
END_COMMAND:

# Get the network engineer role
COMMAND_ID: get-user-auth-roles
RESOURCE_URL: @root-document.userauthz-index-uri@
HTTP_METHOD: GET
CONTENT_TYPE: text/xml
VERSION: 1
VARS:
  @COMMAND_ID@.ne-role: XPATH(//authz:authorizationPolicy[contains(authz:name,'Network_Engineer')]/@da:url)
END_VARS:
END_COMMAND:

# Update the network engineer role to have all the required privileges
COMMAND_ID: modify-network-engineer-role
RESOURCE_URL: @get-user-auth-roles.ne-role@
HTTP_METHOD: PUT
CONTENT_TYPE: text/xml
VERSION: 1
BODY: <authz:authorizationPolicy xmlns:da="http://andrew.com/location/ipl/da" xmlns:authz="http://andrew.com/location/ipl/da/authz">
    <authz:name>Network_Engineer</authz:name>
    <authz:privileges>
        <authz:privilege category="accessnetwork">MODIFY</authz:privilege>
        <authz:privilege category="agnss">MODIFY</authz:privilege>
        <authz:privilege category="cell">MODIFY</authz:privilege>
        <authz:privilege category="cls">MODIFY</authz:privilege>
        <authz:privilege category="dbh">MODIFY</authz:privilege>
        <authz:privilege category="ecid">MODIFY</authz:privilege>
        <authz:privilege category="lcsapservice">MODIFY</authz:privilege>
        <authz:privilege category="locationclient">MODIFY</authz:privilege>
        <authz:privilege category="ne">VIEW</authz:privilege>
        <authz:privilege category="oam">MODIFY</authz:privilege>
        <authz:privilege category="otdoa">MODIFY</authz:privilege>
        <authz:privilege category="password">MODIFY</authz:privilege>
        <authz:privilege category="rfsp">MODIFY</authz:privilege>
        <authz:privilege category="ubp">MODIFY</authz:privilege>
        <authz:privilege category="warn">MODIFY</authz:privilege>
    </authz:privileges>
  </authz:authorizationPolicy>
END_BODY:
END_COMMAND:

