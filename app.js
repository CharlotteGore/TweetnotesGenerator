const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const mustacheExpress = require('mustache-express');
const config = require('./config.json');
const clientRequest = require('request');
const app = express();
const fs = require('fs');

const mediumRoutes = require('./routes/medium');

// mustache view engine
app.engine('mustache', mustacheExpress());
app.set('view engine', 'mustache');
app.set('views', __dirname + '/views');

// session config...
var sess = {
  store: new RedisStore({db: 1}),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: true,
  cookie: {
    expires: new Date().setFullYear(new Date().getFullYear() + 1),
    maxAge: 31556952000,
    path: '/tweetnotes',
    sameSite: true,
    secure: 'auto'
  }
}

app.use(session(sess));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use(mediumRoutes);

app.get('/tweetnotes/stylesheets/style.css', (req, res) => {
  fs.readFile(__dirname + '/public/stylesheets/style.css', 'utf8', (err, data) => {
    res.type('text/css').send(data);
  })
});

app.post('/tweetnotes/fetch-thread', (req, res) => {
  if (req.body.tweetId){
    fetchThread(req.body.tweetId, [], (list) => {
      list = list.reverse();
      res.render('preview', { rawTweets: list, tweet: () => this });
    }, (err) => {
      res.render('error', { error: `There's been a problem getting the data from Twitter. We got ${err}`})
    });
  } else {
    res.render('error', { error: 'You need to give a twitter id!'});
  }
});

var twitterHeaders = {
  'Authorization': `Bearer ${config.twitter.bearer}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json'
};

var fetchThread = (id, list, done, error) => {
  clientRequest({
    url: `https://api.twitter.com/1.1/statuses/show.json?id=${id}`,
    headers: twitterHeaders
  }, (err, httpResponse, body) => {
    if (!err){
      body = JSON.parse(body);
      list.push(`https://twitter.com/${body.user.screen_name}/status/${body.id_str}`)
      var next = body.in_reply_to_status_id_str
      if (next){
        fetchThread(next, list, done);
      } else {
        done(list);
      }
    } else {
      error(err);
    }
  });
}

app.use('/tweetnotes/', (req, res) => {
  res.render('index', {mediumAuth: req.session.mediumAuth});
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error', {error: res.locals.message});
});

module.exports = app;
