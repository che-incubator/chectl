TEMPLATE=$(jq '.rules."header/header"[2][1].pattern'  configs/eslint.license.json)
CURRENT_YEAR=$(date +'%Y')

if [[ ${TEMPLATE} != *"$CURRENT_YEAR"* ]];then
    echo -e "[INFO] Your license header template doesn't contain the current year. Please change config/eslint.license.json year and run yarn lint:fix"
fi
