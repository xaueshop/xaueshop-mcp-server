/**
 * signer.js — private key signer with flexible key source resolution.
 *
 * Key source priority (first match wins):
 *   1. keyEnv  — name of an env var holding the private key
 *                e.g. keyEnv="MY_KEY" → reads process.env.MY_KEY
 *   2. keyFile — path to a file holding the private key (one line, 0x... or raw hex)
 *                e.g. keyFile="~/trading.key"
 *   3. default — PRIVATE_KEY env var (set in ~/.xaueshop/.env or shell)
 *
 * The raw private key value never travels through agent conversation —
 * only the source location (env var name or file path) is passed as a parameter.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Wallet } from 'ethers';

function expandTilde(p) {
  if (typeof p === 'string' && p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

function toWallet(pk, provider) {
  if (!pk) throw new Error('Private key is empty');
  const key = pk.trim().startsWith('0x') ? pk.trim() : `0x${pk.trim()}`;
  const wallet = new Wallet(key);
  return provider ? wallet.connect(provider) : wallet;
}

/**
 * @param {{ keyEnv?: string, keyFile?: string }} [source]
 * @param {import('ethers').Provider|null} provider
 * @returns {Promise<import('ethers').Wallet>}
 */
export async function createSigner(source = {}, provider = null) {
  // 1. env var name supplied by agent
  if (source.keyEnv) {
    const pk = process.env[source.keyEnv];
    if (!pk) throw new Error(`Env var "${source.keyEnv}" is not set`);
    return toWallet(pk, provider);
  }

  // 2. file path supplied by agent
  if (source.keyFile) {
    let pk;
    try { pk = readFileSync(expandTilde(source.keyFile), 'utf8'); }
    catch (e) { throw new Error(`Cannot read key file "${source.keyFile}": ${e.message}`); }
    return toWallet(pk, provider);
  }

  // 3. default: PRIVATE_KEY env var
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error('No private key found. Set PRIVATE_KEY in env, or pass key_env / key_file.');
  return toWallet(pk, provider);
}
