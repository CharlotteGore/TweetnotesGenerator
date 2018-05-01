const express = require('express');
const router = express.Router();
const config = require('../config.json');
const clientRequest = require('request');
const uuid = require('uuid');

var nonce = null;
const mediumAuthorise = (nonce) => {
  return `https://medium.com/m/oauth/authorize?client_id=${config.medium.key}&scope=basicProfile,publishPost&state=${nonce}&response_type=code&redirect_uri=${encodeURIComponent(config.callbackUri)}`;
};

const mediumHeaders = access_token => ({
  'Authorization': `Bearer ${access_token}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Accept-Charset': 'utf-8'
});

const makeBody = tweetnote => ({
  title: tweetnote.title,
  contentFormat: 'markdown',
  content: convertToMarkdown(tweetnote),
  tags: tweetnote.tags,
  publishStatus: 'draft'
});

const convertToMarkdown = tweetnote => `# ${tweetnote.title}

${tweetnote.description}

${tweetnote.content.join('\n\n')}`;

const postToMedium = (session, tweetnote, done) => {
  const config = {
    url: `https://api.medium.com/v1/users/${session.userId}/posts`,
    headers: headers = mediumHeaders(session.access_token),
    form: makeBody(tweetnote)
  };

  clientRequest.post(config, (err, clientResponse, body) => {
    if (!err){
      done(err);
    }
  });
}

const getUserId = (access_token, done) => {
  clientRequest({
    url: 'https://api.medium.com/v1/me',
    headers: mediumHeaders(access_token)
  }, (err, clientResponse, body) => {
    if (err){
      done(err);
    } else {
      done(null, JSON.parse(body));
    }
  });
}

const checkAndUpdateTokens = (session, done) => {
  // if the token has expired...
  if ((new Date()).getTime() > (new Date(session.expires_at)).getTime()){

    const url = 'https://api.medium.com/v1/tokens';

    const form = {
      refresh_token: session.refresh_token,
      client_id: config.medium.key,
      client_secret: config.medium.secret,
      grant_type: 'refresh_token'
    };

    clientRequest.post({
        url,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Accept-Charset': 'utf-8'
        },
        form
      }, (err, clientResponse, body) => {
        if (!err){
          try {
            body = JSON.parse(body);
            session.access_token = body.access_token;
            session.refresh_token = body.refresh_token;
            session.expires_at = body.expires_at;
            session.mediumAuth = true;
            done(null);
          } catch(e) {
            done(`Weird message back from Medium when asking for a new token, got: ${err}`);
          }
        } else {
          done(`Some network problem when asking Medium for tokens. Got: ${err}`)
        }
      });
  } else {
    done(null);
  }
}

router.get('/tweetnotes/medium-login', (req, res) => {
  nonce = uuid.v4();
  res.redirect(mediumAuthorise(nonce));
});

router.get('/tweetnotes/logout', (req, res) => {
  req.session.destroy(() => {
    res.render('loggedout', {});
  })
});

router.post('/tweetnotes/post-to-medium', (req, res) => {
  if (!req.body) return res.status(400).send('Uh oh!');

  if (req.body.title && req.body.description && req.body.content){
    var { title, description, content, tags } = req.body;
    if (tags){
      tags = req.body.tags.split(',').map(m => m.trim());
    } else {
      tags = [];
    }
    content = content.split(',');

    const tweetnote = {
      title,
      description,
      tags,
      content
    };

    checkAndUpdateTokens(req.session, (err) => {
      if (err){
        res.render('error', { error: `Your access token to Medium has expired and we were unable to get a new one. Hmmm. We got ${err}`});
      } else {
        postToMedium(req.session, tweetnote, (err) => {
          if (!err){
            res.render('alldone', {});
          } else {
            res.render('error', { error: `There was a problem sending this Tweetnote to Medium... do check your drafts before retrying, though!`});
          }
        });
      }
    });

  } else {
    res.render('error', {error: `Something's missing! Title and description are compulsory!`})
  }
});

router.get('/tweetnotes/medium-callback', (req, res) => {
  if (req.query.state && req.query.state === nonce && req.query.code){
    nonce = null;

    const form = {
      code: req.query.code,
      client_id: config.medium.key,
      client_secret: config.medium.secret,
      grant_type: 'authorization_code',
      redirect_uri: config.callbackUri
    };

    const url = 'https://api.medium.com/v1/tokens';

    clientRequest.post({
        url,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'Accept-Charset': 'utf-8'
        },
        form
      }, (err, clientResponse, body) => {
        if (!err){
          try {
            body = JSON.parse(body);
            req.session.access_token = body.access_token;
            req.session.refresh_token = body.refresh_token;
            req.session.expires_at = body.expires_at;

            getUserId(body.access_token, (err, body) => {
              if (err){
                res.render('error', { error: `Couldn't load UserId from Medium. Got: ${err}`});
              } else {
                req.session.userId = body.data.id;
                req.session.mediumAuth = true;
                res.render('loggedin');
              }
            });

          } catch(e) {
            res.render('error', { error: `Got a weird message back from Medium after asking for tokens. Got: ${err}`});
          }
        } else {
          res.render('error', { error: `Some network problem when asking Medium for tokens. Got: ${err}`});
          res.status(500).send(err);
        }
      });
  } else if (req.query.error) {
    res.redirect('/tweetnotes');
  } else {
    res.status(400).send('Oops');
  }
});

module.exports = router;
