const core = require('@actions/core');
const github = require('@actions/github');
const octokit = github.getOctokit(core.getInput('token'));

const fetch = require('node-fetch');
const AdmZip = require("adm-zip");

async function findWorkflowRun(workflow_name) {
  core.startGroup(`Fetching latest runs for ${workflow_name}...`);

  const runs = await octokit.rest.actions.listWorkflowRuns({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    workflow_id: `${workflow_name}`,
    status: 'completed',
    per_page: 5
  });

  if (runs.status === 200 && runs.data.total_count >= 0) {
    core.info(`Found ${runs.data.total_count} workflow runs.`);

    const first = runs.data.workflow_runs[0];
    core.info(`Run ${first.id} started at ${first.run_started_at}.`);

    const last = runs.data.workflow_runs[runs.data.workflow_runs.length - 1];
    core.info(`Run ${last.id} started at ${last.run_started_at}.`);
    core.info('');
    core.endGroup();

    return parseInt(first.id);
  }

  core.info(JSON.stringify(runs));
  core.info('');
  core.endGroup();

  throw new Error(`Unable to fetch workflow runs for ${workflow_name}.`);
}

async function findArtifact(workflow_run, artifact_name) {
  core.startGroup(`Fetching artifacts for run ${workflow_run}...`);

  const artifacts = await octokit.rest.actions.listWorkflowRunArtifacts({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    run_id: workflow_run
  });

  if (artifacts.status === 200 && artifacts.data.total_count > 0) {
    core.info(`Found ${artifacts.data.total_count} artifacts.`);
    const found = artifacts.data.artifacts.find(r => artifact_name === r.name);

    if (found !== undefined) {
      core.info(`Found artifact ${found.id} named ${found.name}.`);
      core.info('');
      core.endGroup();

      return parseInt(found.id);
    }
  }

  core.info(JSON.stringify(artifacts));
  core.info('');
  core.endGroup();

  throw new Error(`Unable to find ${artifact_name} for run ${workflow_run}.`);
}

async function downloadArtifact(artifact_id, artifact_json) {
  core.startGroup(`Downloading artifact id ${artifact_id}...`);

  const downloader = await octokit.rest.actions.downloadArtifact({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    artifact_id: artifact_id,
    archive_format: 'zip'
  });

  if (downloader.status === 200) {
    core.info(`Using ${downloader.url} for download.`);

    // https://github.com/bettermarks/action-artifact-download
    const zip = new AdmZip(Buffer.from(downloader.data));
    const entries = zip.getEntries();
    core.info(`Found ${entries.length} entries in zip file.`);

    const found = entries.find(r => artifact_json == r.name);

    if (found !== undefined) {
      core.info(`Found ${found.name} in archive.`);

      const data = zip.readAsText(found);
      const parsed = JSON.parse(data);

      core.info(`Parsed: ${JSON.stringify(parsed)}`);
      return parsed;
    }
    else {
      core.info(`Entries: ${entries.map(r => r.entryName)}`);
    }
  }

  core.info(JSON.stringify(downloader));
  core.info('');
  core.endGroup();

  throw new Error(`Unable to download ${artifact_id}.`);
}

async function run() {
  try {
    const artifact_name = core.getInput('artifact_name', { required: true });
    const artifact_json = core.getInput('artifact_json', { required: true });
    const workflow_name = core.getInput('workflow_name', { required: true });

    core.info(`Artifact Name: ${artifact_name}`);
    core.info(`Artifact JSON: ${artifact_json}`);
    core.info(`Workflow Name: ${workflow_name}`);

    // use provided workflow run or find the latest one
    let workflow_run = core.getInput('workflow_run', { required: false });
    
    if (workflow_run) {
      workflow_run = parseInt(workflow_run);
      core.info(`Workflow Run:  ${workflow_run}`);
      core.info('');
    }
    else {
      core.info('');
      workflow_run = await findWorkflowRun(workflow_name);
    }

    // download artifact zip, extract file, and parse as JSON
    const artifact_id = await findArtifact(workflow_run, artifact_name);
    const parsed = await downloadArtifact(artifact_id, artifact_json);

    // set output based on downloaded json
    core.setOutput('json_string', JSON.stringify(parsed));

    for (property in parsed) {
      core.setOutput(property, JSON.stringify(parsed[property]));
    }
  }
  catch (error) {
    core.startGroup('Outputting payload...');
    console.log(JSON.stringify(github.context.payload));
    core.endGroup();
  
    core.startGroup('Outputting context...');
    console.log(JSON.stringify(github.context));
    core.endGroup();
  
    core.setFailed(error.message);
  }
}

run();
