# TikTok token-key rotation

TikTok token encryption is provider-specific and independent from Discord token
encryption.

## Formats and keyring

- Existing `tiktok:v1:<iv>:<tag>:<ciphertext>` rows remain decryptable with the
  current `AUTH_SECRET` derivation. Discord continues using its existing
  `v1:<iv>:<tag>:<ciphertext>` format and is not changed by TikTok rotation.
- An approved TikTok keyring writes
  `tiktok:v2:<key-id>:<iv>:<tag>:<ciphertext>`.
- `TIKTOK_TOKEN_ENCRYPTION_KEYS` contains comma-separated
  `key-id=base64url-32-byte-key` entries. `TIKTOK_TOKEN_ENCRYPTION_ACTIVE_KEY`
  selects the key used for new writes.
- Key material must be generated, stored, and backed up by the deployment
  secret manager. KOMU does not generate, print, or log production keys.

## Approved rotation procedure

1. Generate a new random 32-byte key in the secret manager and assign a new
   non-secret key id.
2. Deploy the keyring containing both the old and new keys, with the new id
   active. Existing v1 and older v2 rows remain readable.
3. Run an authenticated, bounded re-encryption job that reads tokens only on
   the server, decrypts with the recorded version, and writes the active v2
   format using a credential-version CAS. Never send tokens to logs or the
   browser.
4. Verify the re-encryption count, failed-row report, and backup recovery
   procedure. Keep the old key until every row and backup-retention decision
   is accounted for.
5. Remove the old key only after an approved recovery window. Rows that cannot
   be decrypted must remain blocked and require reauthorization; they must not
   be rewritten with empty credentials.

The current implementation provides the versioned format, dual-key reads,
`reencryptTikTokToken`, and the CAS-bound bounded operator function
`reencryptTikTokConnectionTokens`. It does not run the re-encryption job
automatically. Production key rotation requires a separate approval and
operational runbook.
