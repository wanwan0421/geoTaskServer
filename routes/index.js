/**
 * Author: Fengyuan(Franklin) Zhang
 * Date: 2018/12/24
 * Description: Index Router
 */
var fs = require('fs');

var serverRouter = require('./server');
var taskRouter = require('./task');
var dxserverRouter = require('./dataExServer')
var ManagerSelfCtrl = require('../controls/mangerSelf');
// var deployRouter = require('./deploy');

module.exports = function (app) {
  app.route('/ping')
    .get(function (req, res, next) {
      res.end('OK');
    });

  serverRouter(app);
  taskRouter(app);
  dxserverRouter(app);
  // deployRouter(app);

  //! task server register or unregister to the Manager Server
  app.route('/manager')
    .put(function (req, res, next) {
      var ac = req.query.ac;
      if (ac == 'register') {
        ManagerSelfCtrl.register(function (err, data) {
          if (err) {
            return res.end(JSON.stringify({
              result: 'err',
              code: -1,
              message: err.message,
              data: ''
            }));
          }
          if (data) {
            return res.end(JSON.stringify({
              result: 'suc',
              code: 1,
              message: 'register successful',
              data: ''
            }));
          }else{
            return res.end(JSON.stringify({
              result: 'err',
              code: 0,
              message: 'register has meet some problem',
              data: ''
            }));
          }
        })
      }
      else if (ac == 'unregister') {
        ManagerSelfCtrl.unregister(function(err, data){
          if (err) {
            return res.end(JSON.stringify({
              result: 'err',
              code: -1,
              message: err.message,
              data: ''
            }));
          }

          if (data) {
            return res.end(JSON.stringify({
              result: 'suc',
              code: 1,
              message: 'unregister successful',
              data: ''
            }));
          }else{
            return res.end(JSON.stringify({
              result: 'err',
              code: 0,
              message: 'unregister has meet some problem',
              data: ''
            }));
          }
        })
      }
      else {
        return res.end(JSON.stringify({
          result: 'err',
          code: -1,
          message: 'query param is wrong',
          data: ''
        }));
      }
    })

}
