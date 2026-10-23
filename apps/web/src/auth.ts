import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
export const configured = Boolean(
  import.meta.env.VITE_COGNITO_DOMAIN &&
  import.meta.env.VITE_COGNITO_CLIENT_ID &&
  import.meta.env.VITE_API_URL &&
  import.meta.env.VITE_COGNITO_ISSUER,
);
const domain = import.meta.env.VITE_COGNITO_DOMAIN ?? '';
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID ?? '';
export const auth = configured
  ? new UserManager({
      authority: domain,
      client_id: clientId,
      redirect_uri: import.meta.env.VITE_REDIRECT_URI ?? window.location.origin + '/callback',
      response_type: 'code',
      scope: 'openid email profile',
      automaticSilentRenew: false,
      userStore: new WebStorageStateStore({ store: sessionStorage }),
      metadata: {
        issuer: import.meta.env.VITE_COGNITO_ISSUER ?? domain,
        authorization_endpoint: domain + '/oauth2/authorize',
        token_endpoint: domain + '/oauth2/token',
        end_session_endpoint: domain + '/logout',
      },
    })
  : undefined;
export async function logout() {
  await auth?.removeUser();
  await auth?.clearStaleState();
  window.location.assign(
    domain +
      '/logout?client_id=' +
      encodeURIComponent(clientId) +
      '&logout_uri=' +
      encodeURIComponent(window.location.origin),
  );
}
