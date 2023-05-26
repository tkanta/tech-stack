# ---------------------------------------------------------
# This script verifies that the cls privilege is present in the Network Engineer 
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

# Check to see if the cls privilege is present
COMMAND_ID: verify-network-engineer-role
RESOURCE_URL: @get-user-auth-roles.ne-role@
HTTP_METHOD: GET
CONTENT_TYPE: text/xml
VERSION: 1
VARS:
  @COMMAND_ID@.ne-role: XPATH(//authz:privilege[@category="cls"]/text())
END_VARS:
END_COMMAND:

