import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSigner } from '../lib/signer.js';

// Known Anvil/Hardhat test key — safe to use in tests, never holds real funds.
const TEST_KEY     = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Save and restore process.env around each test to avoid pollution.
let savedEnv;
test.beforeEach(() => { savedEnv = { ...process.env }; });
test.afterEach(()  => {
  for (const k of Object.keys(process.env)) {
    if (!(k in savedEnv)) delete process.env[k];
  }
  Object.assign(process.env, savedEnv);
});

// ---------------------------------------------------------------------------
// default: PRIVATE_KEY env var
// ---------------------------------------------------------------------------

test('default: reads PRIVATE_KEY from env', async () => {
  process.env.PRIVATE_KEY = TEST_KEY;
  const signer = await createSigner();
  assert.equal(await signer.getAddress(), TEST_ADDRESS);
});

test('default: accepts key without 0x prefix', async () => {
  process.env.PRIVATE_KEY = TEST_KEY.slice(2); // strip 0x
  const signer = await createSigner();
  assert.equal(await signer.getAddress(), TEST_ADDRESS);
});

test('default: throws when PRIVATE_KEY not set', async () => {
  delete process.env.PRIVATE_KEY;
  await assert.rejects(
    () => createSigner(),
    /No private key found/,
  );
});

// ---------------------------------------------------------------------------
// key_env: named env var
// ---------------------------------------------------------------------------

test('key_env: reads from the named env var', async () => {
  process.env.MY_TRADING_KEY = TEST_KEY;
  const signer = await createSigner({ keyEnv: 'MY_TRADING_KEY' });
  assert.equal(await signer.getAddress(), TEST_ADDRESS);
});

test('key_env: throws when named env var is not set', async () => {
  delete process.env.MISSING_KEY;
  await assert.rejects(
    () => createSigner({ keyEnv: 'MISSING_KEY' }),
    /Env var "MISSING_KEY" is not set/,
  );
});

test('key_env: takes priority over PRIVATE_KEY', async () => {
  process.env.PRIVATE_KEY  = '0x' + '1'.repeat(64); // different key
  process.env.MY_TRADING_KEY = TEST_KEY;
  const signer = await createSigner({ keyEnv: 'MY_TRADING_KEY' });
  assert.equal(await signer.getAddress(), TEST_ADDRESS);
});

// ---------------------------------------------------------------------------
// key_file: file path
// ---------------------------------------------------------------------------

test('key_file: reads private key from file', async () => {
  const dir  = mkdtempSync(join(tmpdir(), 'signer-test-'));
  const path = join(dir, 'key.txt');
  try {
    writeFileSync(path, TEST_KEY + '\n');
    const signer = await createSigner({ keyFile: path });
    assert.equal(await signer.getAddress(), TEST_ADDRESS);
  } finally { rmSync(dir, { recursive: true }); }
});

test('key_file: accepts key without 0x prefix in file', async () => {
  const dir  = mkdtempSync(join(tmpdir(), 'signer-test-'));
  const path = join(dir, 'key.txt');
  try {
    writeFileSync(path, TEST_KEY.slice(2));
    const signer = await createSigner({ keyFile: path });
    assert.equal(await signer.getAddress(), TEST_ADDRESS);
  } finally { rmSync(dir, { recursive: true }); }
});

test('key_file: throws when file does not exist', async () => {
  await assert.rejects(
    () => createSigner({ keyFile: '/tmp/nonexistent-xaue-key.txt' }),
    /Cannot read key file/,
  );
});

test('key_file: takes priority over PRIVATE_KEY', async () => {
  const dir  = mkdtempSync(join(tmpdir(), 'signer-test-'));
  const path = join(dir, 'key.txt');
  try {
    writeFileSync(path, TEST_KEY);
    process.env.PRIVATE_KEY = '0x' + '1'.repeat(64); // different key
    const signer = await createSigner({ keyFile: path });
    assert.equal(await signer.getAddress(), TEST_ADDRESS);
  } finally { rmSync(dir, { recursive: true }); }
});

// ---------------------------------------------------------------------------
// priority: key_env wins over key_file
// ---------------------------------------------------------------------------

test('key_env takes priority over key_file', async () => {
  const dir  = mkdtempSync(join(tmpdir(), 'signer-test-'));
  const path = join(dir, 'key.txt');
  try {
    writeFileSync(path, '0x' + '1'.repeat(64)); // different key in file
    process.env.MY_KEY = TEST_KEY;
    const signer = await createSigner({ keyEnv: 'MY_KEY', keyFile: path });
    assert.equal(await signer.getAddress(), TEST_ADDRESS);
  } finally { rmSync(dir, { recursive: true }); }
});
