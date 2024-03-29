import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { OAuthStrategy as GoogleStrategy } from 'passport-google-oauth';
import passportJWT from 'passport-jwt';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import Users, { UserDoc } from '../models/users';
import { app, auth } from '../index';
import _ from 'lodash';
import { Request, Response, Errback } from 'express';

const JWTStrategy = passportJWT.Strategy;
const ExtractJWT = passportJWT.ExtractJwt;
const ENVS = {
  TOKEN_SECRET: 'this_is_still_todo_in_envs',
  FACEBOOK_CLIENT: '1016922761801466',
  FACEBOOK_SECRET: '60ea5186f6c10ee0e9d1fbfbe1528272',
  GOOGLE_CLIENT:
    '723326403476-m4lpsnb7d7logi84tbsablt1khh1rdvj.apps.googleusercontent.com',
  GOOGLE_SECRET: 'zHpobzCwj28KrTsRkEiggfTa'
};

const passwordStrategy = new LocalStrategy((username, password, done) => {
  Users.findOne({ username })
    .then(user => {
      if (user === null) {
        done(null, false);
        return;
      }

      // Comparison must be constant time for security
      bcrypt
        .compare(password, user.password)
        .then(result => {
          if (!result) {
            done(null, false);
          }

          done(null, user);
        })
        .catch(err => done(err));
    })
    .catch(err => done(err));
});

const facebookStrategy = new FacebookStrategy(
  {
    clientID: ENVS.FACEBOOK_CLIENT,
    clientSecret: ENVS.FACEBOOK_SECRET,
    callbackURL: 'http://localhost:8080/auth/facebook/callback',
    enableProof: true
  },
  (accessToken, refreshToken, profile, callback) => {
    const { id: facebookId, displayName } = profile;

    Users.findOneAndUpdate(
      { facebookId },
      { $set: { facebookId, displayName } },
      { upsert: true, new: true }
    ).then(user => {
      callback(null, user);
    });
  }
);

const googleStrategy = new GoogleStrategy(
  {
    consumerKey: ENVS.GOOGLE_CLIENT,
    consumerSecret: ENVS.GOOGLE_SECRET,
    callbackURL: 'http://localhost:8080/auth/google/callback'
  },
  (token, tokenSecret, profile, done) => {
    const { id: googleId, displayName } = profile;

    Users.findOneAndUpdate(
      { googleId },
      { $set: { googleId, displayName } },
      { upsert: true, new: true }
    ).then(user => {
      done(null, user);
    });
  }
);

const jwtStrategy = new JWTStrategy(
  {
    jwtFromRequest: ExtractJWT.fromAuthHeaderAsBearerToken(),
    secretOrKey: ENVS.TOKEN_SECRET
  },
  (userPayload, done) => {
    return Users.findOne({ _id: userPayload._id })
      .then(user => done(null, user))
      .catch(err => done(err));
  }
);

passport.use(passwordStrategy);
passport.use(facebookStrategy);
passport.use(googleStrategy);
passport.use(jwtStrategy);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

function loginUser({
  err,
  user,
  req,
  res
}: {
  err: Errback | null;
  user: UserDoc;
  req: Request;
  res: Response;
}) {
  if (err || !user) {
    res.status(400).send();
  } else {
    req.login(user, { session: false }, err => {
      if (err) {
        res.status(400).send();
      } else {
        const tokenPayload = _.pick(user, ['_id']);
        const token = jwt.sign(tokenPayload, ENVS.TOKEN_SECRET);

        res.cookie('token', token);
        res.redirect('/login');
      }
    });
  }
}

app.post('/login', (req, res) => {
  passport.authenticate(
    'local',
    { session: false },
    (err: Errback, user: UserDoc) => loginUser({ err, user, req, res })
  )(req, res);
});

app.post('/register', (req, res) => {
  const { username, password } = req.body;

  Users.countDocuments({ username }).then(isExist => {
    if (isExist) {
      res.status(400).send();
    } else {
      const user = new Users({
        username,
        password,
        bookIds: []
      });

      user
        .save()
        .then(savedUser => loginUser({ err: null, user: savedUser, req, res }))
        .catch(() => res.status(500).send());
    }
  });
});

app.get('/logout', req => req.logout());

auth.get('/facebook', passport.authenticate('facebook'));

auth.get(
  '/facebook/callback',
  passport.authenticate('facebook', { failureRedirect: '/login?failed=true' }),
  (req, res) => loginUser({ err: null, user: req.user, req, res })
);

auth.get('/google', passport.authenticate('google', { scope: ['profile'] }));

auth.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?failed=true' }),
  (req, res) => loginUser({ err: null, user: req.user, req, res })
);

auth.get('/token', (req, res) => {
  const cookies = req.cookies || {};
  const token = cookies.token;

  res.clearCookie('token');
  res.json({ token });
});
