/** The empty database the `setup` e2e project runs against: TEST_DATABASE_URL with another name. */
export function setupDatabaseUrl(): string {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = "/sparepartslk_setup_e2e";
  return url.toString();
}

/** The setup key the setup e2e server is started with (24+ characters). */
export const E2E_SETUP_KEY = "e2e-setup-key-0123456789abcd";
