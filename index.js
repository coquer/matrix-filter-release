import * as core from '@actions/core';
import fs from 'node:fs';
import { Octokit } from '@octokit/rest'
import { HttpsProxyAgent } from 'https-proxy-agent';

const GH_API_URL = 'https://api.github.com';

async function run() {
  const inputs = {
    token: core.getInput('token') || process.env.GITHUB_TOKEN,
    list: core.getInput('list') || process.env.MATRIX_LIST,
    ref: core.getInput('ref') || process.env.GITHUB_REF_NAME,
    repository: core.getInput('repository') || process.env.GITHUB_REPOSITORY,
    is_slice: core.getInput('is_slice') || process.env.IS_SLICE,
    filter_by: core.getInput('filter_by') || process.env.FILTER_BY
  }

  core.info('list: ' + inputs.list);
  core.info('ref: ' + inputs.ref);
  core.info('repository: ' + inputs.repository);
  core.info('filter_by: ' + inputs.filter_by);

  if (!inputs.token) {
    core.setFailed('No token provided');
    return;
  }

  if (!inputs.list) {
    core.setFailed('No list provided');
    return;
  }

  const content = await fs.promises.readFile(inputs.list, 'utf8')

  if (!content) {
    core.setFailed('No content in the list');
    return;
  }

  // noinspection JSCheckFunctionSignatures
  const list = JSON.parse(content);

  if (!list) {
    core.setFailed('Invalid list');
    return;
  }

  const octokit = new Octokit({
    auth: inputs.token,
    baseUrl: GH_API_URL,
    request: {
      agent: new HttpsProxyAgent(GH_API_URL),
    }
  });

  const repository = process.env.GITHUB_REPOSITORY.split('/');

  if (repository.length !== 2) {
    core.setFailed('Invalid repository');
    return;
  }

  const owner = repository[0];
  const repo = repository[1];

  try {
    const response = await octokit.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: await getBaseHead(octokit, owner, repo, inputs.ref)
    });

    const files = response.data.files;

    if (!files) {
      core.info('No files changed in the commit');
      core.setOutput('filtered', '[]');
      return;
    }

    const resultFileChanges = files.map((file) => file.filename);
    const filtered = resultFileChanges.filter((item, index) => resultFileChanges.indexOf(item) === index).map((file) => file.substr(0, file.indexOf('/')))
        .filter((item, index) => item.indexOf('/') === -1 && item.length > 0);
    const uniqueDirs = filtered.filter((item, index) => filtered.indexOf(item) === index);

    const filterBy = inputs.filter_by;
    const isSlice = inputs.is_slice === 'true';

    let filteredMatrix = null;

    if (false === isSlice) {
      filteredMatrix = list.filter(({service}) => uniqueDirs.includes(service));
    } else {
      let selectedItem = list[filterBy];

      if (typeof selectedItem === 'object' && selectedItem[Object.keys(selectedItem)[0]] instanceof Object) {
        selectedItem = Object.keys(selectedItem);
      }

      filteredMatrix = selectedItem.filter((key) => uniqueDirs.includes(key));
    }

    if (!filteredMatrix) {
      core.info('No services found in the list');
      core.setOutput('filtered', '[]');
      return;
    }

    core.setOutput('filtered', JSON.stringify(filteredMatrix));
  } catch (error) {
    core.info("There is not tag in the repository, returning full list");
    core.setOutput('filtered', JSON.stringify(list));
  }
}

async function getBaseHead(octokit, owner, repo, ref) {
  const defaultBranch = await getDefaultBranch(octokit, owner, repo);
  const lastTag = await getLastTag(octokit, owner, repo);
  const reference = await calculateRef(octokit, owner, repo, ref);

  core.info('defaultBranch: ' + defaultBranch);
  core.info('lastTag: ' + lastTag);
  core.info('reference: ' + reference);

  if (reference === defaultBranch) {
    if (lastTag === '') {
      throw new Error('No tags found in the repository');
    }

    core.info('diff: ' + `${lastTag}...${defaultBranch}`);
    return `${lastTag}...${defaultBranch}`;
  }

  return `${defaultBranch}...${reference}`;
}

async function calculateRef(octokit, owner, repo, ref) {
  const refParts = ref.split('/');

  if (refParts.length === 2 || refParts.length === 3) {
    const prNumber = refParts[0];
    const merge = refParts[1];

    if (isNaN(prNumber) || merge !== 'merge') {
      return ref;
    }

    const {data} = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber
    });

    return data.head.sha;
  }

  return ref;
}

async function getDefaultBranch(octokit, owner, repo) {
  const {data} = await octokit.repos.get({
    owner,
    repo
  });

  return data.default_branch;
}

async function getLastTag(octokit, owner, repo) {
  const {data} = await octokit.repos.listTags({
    owner,
    repo
  });

  if (data.length === 0) {
    return '';
  }

  return data[0].name;
}

run().catch((error) => {
  core.setFailed(error.message);
});

