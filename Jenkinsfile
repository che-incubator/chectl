#!/usr/bin/env groovy

// PARAMETERS for this pipeline:
// branchToBuildCTL = refs/tags/20190401211444 or master
// DESTINATION = user@host_or_ip:/path/to/che-incubator/chectl
// BASE_URL = https://host_or_ip/path/to/che-incubator/chectl

def installNPM(){
	def nodeHome = tool 'nodejs-10.15.3'
	env.PATH="${env.PATH}:${nodeHome}/bin"
	sh "npm install -g yarn && yarn global add cpx rimraf oclif && yarn install -f oclif-dev"
	sh "npm version && npm -v && yarn -v"
}

// TODO: re-add win-x64; fails due to missing 7zip: "Error: install 7-zip to package windows tarball"
def platforms = "linux-x64,darwin-x64,linux-arm"
def CTL_path = "chectl"
def SHA_CTL = "SHA_CTL"
timeout(180) {
	node("rhel7-releng"){ stage "Build ${CTL_path}"
		cleanWs()
		checkout([$class: 'GitSCM', 
			branches: [[name: "${branchToBuildCTL}"]], 
			doGenerateSubmoduleConfigurations: false, 
			poll: true,
			extensions: [[$class: 'RelativeTargetDirectory', relativeTargetDir: "${CTL_path}"]], 
			submoduleCfg: [], 
			userRemoteConfigs: [[url: "https://github.com/che-incubator/${CTL_path}.git"]]])
		installNPM()
		SHA_CTL = sh(returnStdout:true,script:"cd ${CTL_path}/ && git rev-parse --short=4 HEAD").trim()
		sh "cd ${CTL_path}/ && sed -i -e 's#version\": \"\\(.*\\)\",#version\": \"\\1-'${SHA_CTL}'\",#' package.json"
		sh "cd ${CTL_path}/ && egrep -v 'versioned|oclif' package.json | grep -e version"
		sh "cd ${CTL_path}/ && yarn && npx oclif-dev pack -t ${platforms} && find ./dist/ -name \"*.tar*\""
		stash name: 'stashDist', includes: findFiles(glob: "${CTL_path}/dist/").join(", ")
	}
}
timeout(180) {
	node("rhel7-releng"){ stage "Publish ${CTL_path}"
		unstash 'stashDist'
		sh "cd ${CTL_path}/ && find ./dist/ -name \"*.tar*\" && rsync -arzq --protocol=28 ./dist/* ${DESTINATION}/dist/"
		archiveArtifacts fingerprint: false, artifacts:"**/*.log, **/*logs/**, **/dist/**/*.tar.gz, **/dist/*.json, **/dist/linux-x64, **/dist/linux-arm, **/dist/darwin-x64"
	}
}
