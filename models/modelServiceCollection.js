/**
 * Author : Fengyuan(Franklin) Zhang
 * Date : 2019/3/4
 * Description : Model for model service collection
 */

 var ModelServiceCollection = function () {
     this.mss = [];  
 }

 module.exports = ModelServiceCollection;

 ModelServiceCollection.prototype.insertModelService = function (ms) {
     delete ms["ms_path"];
     delete ms["ms_user"];
     delete ms['ms_model']["m_register"];
     ms['_id'] = ms['ms_model']['p_id'];
     var ms_i = this.getModelServiceByPID(ms.ms_model.p_id);
     if(ms_i == null){
         ms.serversCount = 1;
         this.mss.push(ms);
         return 1;
     }
     else{
         ms_i.serversCount++;
     }
     return 0;
 }

 ModelServiceCollection.prototype.getModelServiceByPID = function(pid){
     for(var i = 0; i < this.mss.length; i++){
         if(this.mss[i].pid == pid){
             return this.mss[i];
         }
     }
     return null;
 }

 ModelServiceCollection.prototype.getAllModelServices = function () {
     return this.mss;
 }