import {type OAuth2Tokens, type DeviceAndUserCode, type Utils as YTUtils} from 'volumio-youtubei.js';
import type Innertube from 'volumio-youtubei.js';
import ytmusic from '../YTMusicContext';
import EventEmitter from 'events';

export enum AuthStatus {
  SignedIn = 'SignedIn',
  SignedOut = 'SignedOut',
  SigningIn = 'SigningIn',
  Error = 'Error'
}

export interface AuthStatusInfo {
  status: AuthStatus;
  verificationInfo?: {
    verificationUrl: string,
    userCode: string
  } | null;
  error?: YTUtils.OAuth2Error;
}

const INITIAL_SIGNED_OUT_STATUS: AuthStatusInfo = {
  status: AuthStatus.SignedOut,
  verificationInfo: null
};

export enum AuthEvent {
  SignIn = 'SignIn',
  SignOut = 'SignOut',
  Pending = 'Pending',
  Error = 'Error'
}

export default class Auth extends EventEmitter {

  #innertube: Innertube | null;
  #handlers: any;
  #handlersRegistered: boolean;

  constructor() {
    super();
    this.#innertube = null;
    this.#handlersRegistered = false;
  }

  static create(innertube: Innertube) {
    const auth = new Auth();
    auth.#innertube = innertube;
    auth.#handlers = {
      onSuccess: auth.#handleSuccess.bind(auth),
      onPending: auth.#handlePending.bind(auth),
      onError: auth.#handleError.bind(auth),
      onCredentials: auth.#handleSuccess.bind(auth)
    };
    return auth;
  }

  dispose() {
    this.#unregisterHandlers();
    this.removeAllListeners();
    this.#innertube = null;
  }

  #handlePending(data: DeviceAndUserCode) {
    ytmusic.set<AuthStatusInfo>('authStatusInfo', {
      status: AuthStatus.SignedOut,
      verificationInfo: {
        verificationUrl: data.verification_url,
        userCode: data.user_code
      }
    });
    ytmusic.getLogger().info(`[ytmusic] Obtained device code for sign-in (expires in ${data.expires_in} seconds)`);
    ytmusic.refreshUIConfig();
    this.emit(AuthEvent.Pending);
  }

  #handleSuccess(data: { credentials: OAuth2Tokens }) {
    ytmusic.setConfigValue('authCredentials', data.credentials);
    ytmusic.getLogger().info('[ytmusic] Auth credentials updated');
  }

  #handleError(err: YTUtils.OAuth2Error) {
    if (err.info.error === 'expired_token') {
      ytmusic.getLogger().info('[ytmusic] Device code for sign-in expired - refetch');
      this.signIn(); // This will refetch the code and refresh UI config
      return;
    }
    ytmusic.set<AuthStatusInfo>('authStatusInfo', {
      status: AuthStatus.Error,
      error: err
    });
    ytmusic.toast('error', ytmusic.getI18n('YTMUSIC_ERR_SIGN_IN', ytmusic.getErrorMessage('', err, false)));
    ytmusic.refreshUIConfig();
    this.emit(AuthEvent.Error);
  }

  #registerHandlers() {
    if (this.#innertube?.session && !this.#handlersRegistered) {
      this.#innertube.session.on('auth', this.#handlers.onSuccess);
      this.#innertube.session.on('auth-pending', this.#handlers.onPending);
      this.#innertube.session.on('auth-error', this.#handlers.onError);
      this.#innertube.session.on('update-credentials', this.#handlers.onCredentials);
      this.#handlersRegistered = true;
    }
  }

  #unregisterHandlers() {
    if (this.#innertube?.session) {
      this.#innertube.session.off('auth', this.#handlers.onSuccess);
      this.#innertube.session.off('auth-pending', this.#handlers.onPending);
      this.#innertube.session.off('auth-error', this.#handlers.onError);
      this.#innertube.session.off('update-credentials', this.#handlers.onCredentials);
    }
    this.#handlersRegistered = false;
  }

  signIn() {
    if (this.#innertube?.session) {
      const credentials = ytmusic.getConfigValue('authCredentials');
      if (credentials) {
        ytmusic.set<AuthStatusInfo>('authStatusInfo', {
          status: AuthStatus.SigningIn
        });
        ytmusic.getLogger().info('[ytmusic] Attempt sign-in with existing credentials');
      }
      else {
        ytmusic.set('authStatusInfo', INITIAL_SIGNED_OUT_STATUS);
        ytmusic.getLogger().info('[ytmusic] Obtaining device code for sign-in...');
      }

      this.#registerHandlers();
      ytmusic.refreshUIConfig();
      this.#innertube.session.signIn(credentials)
      .then(() => {
        const oldStatusInfo = ytmusic.get<AuthStatusInfo>('authStatusInfo');
        if (this.#innertube?.session.logged_in && (!oldStatusInfo || oldStatusInfo.status !== AuthStatus.SignedIn)) {
          ytmusic.set<AuthStatusInfo>('authStatusInfo', {
            status: AuthStatus.SignedIn
          });
          ytmusic.getLogger().info('[ytmusic] Auth success');
          ytmusic.toast('success', ytmusic.getI18n('YTMUSIC_SIGN_IN_SUCCESS'));
          ytmusic.refreshUIConfig();
          this.emit(AuthEvent.SignIn);
        }
      })
      .catch((error: unknown) => {
        ytmusic.getLogger().error(ytmusic.getErrorMessage('[ytmusic] Caught Innertube sign-in error:', error, false));
      });
    }
  }

  async signOut() {
    if (this.#innertube?.session?.logged_in) {
      await this.#innertube.session.signOut();

      ytmusic.deleteConfigValue('authCredentials');
      ytmusic.set<AuthStatusInfo>('authStatusInfo', INITIAL_SIGNED_OUT_STATUS);

      ytmusic.getLogger().info('[ytmusic] Auth revoked');
      ytmusic.toast('success', ytmusic.getI18n('YTMUSIC_SIGNED_OUT'));

      this.emit(AuthEvent.SignOut);
      ytmusic.refreshUIConfig();
    }
  }

  getStatus() {
    return ytmusic.get<AuthStatusInfo>('authStatusInfo') || INITIAL_SIGNED_OUT_STATUS;
  }
}
