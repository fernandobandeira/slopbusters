/**
 * The public client ID of the Slopbusters OAuth application in Linear. It identifies the app and
 * grants nothing on its own: sign-in uses PKCE, so no client secret ships with the app. The
 * application lists the callback from `linearCallbackUrl()`
 * (http://localhost:47811/linear/callback) and has client credentials turned off.
 */
export const LINEAR_CLIENT_ID = '276891c054ca97f2175299f9559ab36a'
