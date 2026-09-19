var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var TaskCtrl = require('./controls/task');
var ServersCtrl = require('./controls/servers');
var DataExServersCtrl = require('./controls/dataExServer');
var indexRouter = require('./routes');

var app = express();

app.use(express.json({ limit: '50mb' })); // JSON 请求限制
app.use(express.urlencoded({ 
  extended: false, 
  limit: '50mb'  // FormData 请求限制
}));

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// use routers
indexRouter(app);

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// init setting
TaskCtrl.init();

// init servers
ServersCtrl.init();

// init rescheduling monitor
// TaskCtrl.rescheduling();

// 监测数据容器是否能连接
DataExServersCtrl.init();

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
  res.render('error');
});

module.exports = app;
