import * as core from '@actions/core';

type SnapshotResponse = {
    success?: boolean;
    status?: string;
    message?: string;
    error?: string;

    repository_id?: string | number;
    github_id?: string | number;

    tx_hash?: string;
    tx_url?: string;

    confirmations?: number;

    manifest_cid?: string;
    commit_hash?: string;
    merkle_root?: string;

    [key: string]: unknown;
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonSafely(text: string): SnapshotResponse | undefined {
    try {
        return text ? (JSON.parse(text) as SnapshotResponse) : undefined;
    } catch {
        return undefined;
    }
}

function normalizeUrlNoTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

async function postJson(
    url: string,
    apiKey: string,
    payload: unknown
): Promise<{ ok: boolean; status: number; statusText: string; text: string; data?: SnapshotResponse }> {
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CodeQuill-Repo-Key': apiKey
        },
        body: JSON.stringify(payload)
    });

    const text = await res.text();
    const data = parseJsonSafely(text);
    return { ok: res.ok, status: res.status, statusText: res.statusText, text, data };
}

async function run(): Promise<void> {
    try {
        const apiUrl = core.getInput('api-url', { required: true });
        const apiKey = core.getInput('api-key', { required: true });

        // Optional: if not provided, will derive from api-url
        const statusApiUrlInput = core.getInput('status-api-url');
        const confirmationsInput = core.getInput('confirmations');
        const pollIntervalSecondsInput = core.getInput('poll-interval-seconds');
        const maxWaitSecondsInput = core.getInput('max-wait-seconds');

        const githubIdInput = core.getInput('github-id');
        const branchInput = core.getInput('branch');

        const githubIdStrFromInput =
            githubIdInput && githubIdInput.trim().length > 0 ? githubIdInput.trim() : '';
        const githubIdStrFromEnv =
            process.env.GITHUB_REPOSITORY_ID && process.env.GITHUB_REPOSITORY_ID.trim().length > 0
                ? process.env.GITHUB_REPOSITORY_ID.trim()
                : '';

        const githubIdStr = githubIdStrFromInput || githubIdStrFromEnv;

        if (!githubIdStr) {
            core.setFailed(
                'Could not determine github-id. Pass the "github-id" input or ensure GITHUB_REPOSITORY_ID is set.'
            );
            return;
        }

        const githubId = Number(githubIdStr);

        if (!Number.isFinite(githubId)) {
            core.setFailed(`Invalid github-id: "${githubIdStr}" is not a finite number.`);
            return;
        }

        const branch =
            branchInput && branchInput.trim().length > 0 ? branchInput.trim() : process.env.GITHUB_REF_NAME || '';

        if (!branch) {
            core.setFailed('Branch could not be determined. Pass inputs.branch or ensure GITHUB_REF_NAME is set.');
            return;
        }

        const confirmations = confirmationsInput && confirmationsInput.trim().length > 0
            ? Number(confirmationsInput.trim())
            : 1;

        if (!Number.isFinite(confirmations) || confirmations < 1) {
            core.setFailed(`Invalid confirmations: "${confirmationsInput}". Must be a number >= 1.`);
            return;
        }

        const pollIntervalSeconds = pollIntervalSecondsInput && pollIntervalSecondsInput.trim().length > 0
            ? Number(pollIntervalSecondsInput.trim())
            : 5;

        if (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds < 1) {
            core.setFailed(`Invalid poll-interval-seconds: "${pollIntervalSecondsInput}". Must be a number >= 1.`);
            return;
        }

        const maxWaitSeconds = maxWaitSecondsInput && maxWaitSecondsInput.trim().length > 0
            ? Number(maxWaitSecondsInput.trim())
            : 600;

        if (!Number.isFinite(maxWaitSeconds) || maxWaitSeconds < 1) {
            core.setFailed(`Invalid max-wait-seconds: "${maxWaitSecondsInput}". Must be a number >= 1.`);
            return;
        }

        const apiUrlNormalized = normalizeUrlNoTrailingSlash(apiUrl);
        const statusApiUrl = statusApiUrlInput && statusApiUrlInput.trim().length > 0
            ? statusApiUrlInput.trim()
            : `${apiUrlNormalized}/status`;

        core.info(`Triggering Code Quill snapshot for repo ${githubId} on branch "${branch}"...`);

        const payload = { github_id: githubId, branch };

        const submit = await postJson(apiUrlNormalized, apiKey, payload);

        if (!submit.ok) {
            const detail = submit.data && (submit.data.error as string | undefined);
            const msg =
                `Code Quill snapshot failed: HTTP ${submit.status} ${submit.statusText}` +
                (detail ? ` - ${detail}` : submit.text ? ` - ${submit.text}` : '');
            core.setFailed(msg);
            return;
        }

        const submitData = submit.data;

        if (!submitData) {
            core.setFailed('Snapshot accepted but response body was empty or not JSON.');
            return;
        }

        core.info(`Snapshot accepted by Code Quill: status=${submitData.status ?? 'n/a'}`);

        if (submitData.commit_hash) core.setOutput('commit-hash', submitData.commit_hash);
        if (submitData.manifest_cid) core.setOutput('manifest-cid', submitData.manifest_cid);
        if (submitData.merkle_root) core.setOutput('merkle-root', submitData.merkle_root);

        const txHash = submitData.tx_hash;
        if (!txHash) {
            // If server didn’t return a hash, we can’t poll; treat as failure because user asked for confirmation step.
            core.setFailed('Snapshot response did not include tx_hash, cannot wait for confirmation.');
            return;
        }

        core.setOutput('tx-hash', txHash);
        core.info(`Transaction sent: ${txHash}`);
        if (submitData.tx_url) core.info(`Explorer: ${submitData.tx_url}`);
        core.info(`Waiting for confirmation (${confirmations} confs, up to ${maxWaitSeconds}s)...`);

        const startedAt = Date.now();
        let attempt = 0;

        while (true) {
            const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);

            if (elapsedSeconds >= maxWaitSeconds) {
                core.setFailed(
                    `Timed out after ${elapsedSeconds}s while waiting for confirmation. tx_hash=${txHash}` +
                    (submitData.tx_url ? ` (${submitData.tx_url})` : '')
                );
                return;
            }

            attempt += 1;

            const pollPayload = { tx_hash: txHash, confirmations };

            const poll = await postJson(statusApiUrl, apiKey, pollPayload);

            // Even if poll endpoint returns non-2xx intermittently, include detail but keep it actionable.
            if (!poll.ok) {
                const detail = poll.data && ((poll.data.message as string | undefined) || (poll.data.error as string | undefined));
                core.info(
                    `Status check attempt #${attempt} got HTTP ${poll.status} ${poll.statusText}` +
                    (detail ? ` - ${detail}` : poll.text ? ` - ${poll.text}` : '')
                );
                await sleep(pollIntervalSeconds * 1000);
                continue;
            }

            const pollData = poll.data;

            if (!pollData) {
                core.info(`Status check attempt #${attempt} returned non-JSON/empty body. Waiting...`);
                await sleep(pollIntervalSeconds * 1000);
                continue;
            }

            const status = (pollData.status || '').toLowerCase();

            if (status === 'confirmed') {
                const confs = typeof pollData.confirmations === 'number' ? pollData.confirmations : undefined;
                core.info(`Transaction confirmed${confs ? ` (${confs} confirmations)` : ''}.`);
                return;
            }

            if (status === 'failed') {
                const msg =
                    (pollData.message as string | undefined) ||
                    (pollData.error as string | undefined) ||
                    'Transaction failed on-chain.';
                core.setFailed(`Code Quill transaction failed: ${msg} tx_hash=${txHash}`);
                return;
            }

            core.info(`Still pending after ${elapsedSeconds}s (attempt #${attempt}). tx_hash=${txHash}`);
            await sleep(pollIntervalSeconds * 1000);
        }
    } catch (err: any) {
        core.setFailed(err?.message ?? String(err));
    }
}

run();