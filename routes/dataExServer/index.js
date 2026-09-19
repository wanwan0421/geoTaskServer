/**
 * Author: Fengyuan(Franklin) Zhang
 * Date: 2019/1/25 
 * Description: Route for date exchange server
 */

var formidable = require('formidable');
var request = require('request');
var CommonMethod = require('../../utils/commonMethod');
var DataExServerCtrl = require('../../controls/dataExServer');
var Setting = require('../../setting');

module.exports = function (app) {
    app.route('/dxserver')
        .post(function(req, res, next){
            var ip = CommonMethod.getIP(req);
            var port = parseInt(req.body.port);
            request.get('http://' + ip + ':' + port + '/ping', function (err, data) {
                if(err){
                    //! TODO Error
                }
                if(data.body == 'OK'){
                    DataExServerCtrl.add({ds_ip : ip, ds_port : port}, function (err, dxserver) {
                        if(err){
                            //! TODO Error
                        }
                        return res.end(JSON.stringify({
                            result : 'suc',
                            code : 1,
                            message : '',
                            data : ''
                        }));
                    });
                }
                else{
                    //! TODO can not build connection
                }
            });
        })
        .get(function(req, res, next){
            if (req.query.ac == 'recommend'){
                DataExServerCtrl.getAll(function(err, items){
                    if(err){
                        return res.end(JSON.stringify({
                            result : 'err',
                            code : -1,
                            message : err.message,
                            data : ''
                        }));
                    }
                    
                    if (items.length < 1){
		    	        //! Modified by MW
                        //it indicate there is no DataExchange Server, so we recommend the Data Service Container
                        var result = {
                            ds_ip: Setting.dataContainer.host,
                            ds_port: Setting.dataContainer.port,
                            type: 2  //Data Service Container
                        };
                        return res.end(JSON.stringify({
                            result : 'suc',
                            code : 1,
                            message : '',
                            data : result
                        }));
                    }


                    //! Reorder
                    //! TODO Select most suitable DX server
                    items = CommonMethod.arrayReorder(items);

                    //! Select one
                    var dxserver = items[0];

                    DataExServerCtrl.getAllByStatus(true ,function(err, onlineServers){

                        if (onlineServers.length < 1){
                            //TODO 没有在线的怎么选
                            //没有在线的话就先选上面那个dxserver

                        } else {
                            onlineServers = CommonMethod.arrayReorder(onlineServers);
                            dxserver = onlineServers[0];
                        }

                        dxserver = {
                            ds_ip : dxserver.ds_ip,
                            ds_port : dxserver.ds_port,
                            ds_status : dxserver.ds_status,
                            // access_url : access_url,  //数据容器部署在内网的话要用这个url访问数据容器
                            type: 1 //dataExchange Server
                        }

                        return res.end(JSON.stringify({
                            result : 'suc',
                            code : 1,
                            message : '',
                            data : dxserver
                        }));

                    });

                    // checkDataExServer(items).then( data => {
                    //     // console.log("res:",data);
                    //
                    //     var dxserver = {
                    //         ds_ip : data.ds_ip,
                    //         ds_port : data.ds_port,
                    //         type: 1 //dataExchange Server
                    //     }
                    //
                    //     return res.end(JSON.stringify({
                    //         result : 'suc',
                    //         code : 1,
                    //         message : '',
                    //         data : dxserver
                    //     }));
                    // })

                    // old version
                    // console.log("main");
                    // dxserver = {
                    //     ds_ip : dxserver.ds_ip,
                    //     ds_port : dxserver.ds_port,
                    //     type: 1 //dataExchange Server
                    // }
                    //
                    // return res.end(JSON.stringify({
                    //     result : 'suc',
                    //     code : 1,
                    //     message : '',
                    //     data : dxserver
                    // }));

                });
            }
        });

}


