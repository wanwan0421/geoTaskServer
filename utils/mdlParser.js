/**
 * Author : Fengyuan(Franklin) Zhang
 * Date : 2018/12/4
 * Description : Javascript Parser for MDL
 */

var xmlparse = require('xml2js').parseString;

var AttributeSet = function(obj){
    this.Categories = [];
    this.LocalAttributes = [];
    try {
        if (typeof obj == 'string'){
            obj = JSON.parse(obj);
        }
        if(obj.Categories){
            if(obj.Categories.Category){
                if(obj.Categories.Category.length && typeof obj.Categoties.Categoty.length == 'number'){
                    for (var i = 0; i < obj.Categories.Category.length; i++){
                        this.Categories.push({
                            principle : obj.Categories.Category[i].$.principle,
                            path : obj.Categories.Category[i].$.path
                        })
                    }
                }
                else{
                    this.Categories.push({
                        principle : obj.Categories.Category.$.principle,
                        path : obj.Categories.Category.$.path
                    })
                }
            }
        }
        if(obj.LocalAttributes){
            if (obj.LocalAttributes.LocalAttribute){
                if (obj.LocalAttributes.LocalAttribute.length && typeof obj.LocalAttribute.length == 'number'){
                    for (var i = 0; i < obj.LocalAttributes.LocalAttribute.length; i++){
                        var keywords = obj.LocalAttributes.LocalAttribute[i].Keywords.spilt(',')
                        this.LocalAttributes.push({
                            local : obj.LocalAttributes.LocalAttribute[i].$.local,
                            localName : obj.LocalAttributes.LocalAttribute[i].$.localName,
                            local : obj.LocalAttributes.LocalAttribute[i].$.wiki,
                            Keywords : keywords,
                            Abstract : obj.LocalAttributes.LocalAttribute[i].Abstract
                        });
                    }
                }
                else{
                    var keywords = obj.LocalAttributes.LocalAttribute.Keywords.split(',');
                    this.LocalAttributes.push({
                        local : obj.LocalAttributes.LocalAttribute.$.local,
                        localName : obj.LocalAttributes.LocalAttribute.$.localName,
                        wiki : obj.LocalAttributes.LocalAttribute.$.wiki,
                        Keywords : keywords,
                        Abstract : obj.LocalAttributes.LocalAttribute.Abstract
                    });
                }
            }
        }
    } catch (error) {
        
    }
};

var State = function(obj){
    this.id = '';
    this.name = '';
    this.type = '';
    this.description = '';
    this.Events = [];

    try {
        if (obj != undefined && obj != null){
            this.id = obj.$.id;
            this.name = obj.$.name;
            this.type = obj.$.type;
            this.description = obj.$.description;
            if (obj.Event){
                if (obj.Event.length && typeof obj.Event.length == 'number'){
                    for (var i = 0; i < obj.Event.length; i++){
                        var event = {
                            name : obj.Event[i].$.name,
                            type : obj.Event[i].$.type,
                            optional : Boolean(obj.Event[i].$.optional),
                            description : obj.Event[i].$.description,
                            ParametersType : null,
                            dataReference : null,
                            dataDescription : ''
                        };
                        if (obj.Event[i].ResponseParameter){
                            event.ParametersType = 'ResponseParameter';
                            event.dataReference = obj.Event[i].ResponseParameter.$.datasetReference;
                            event.dataDescription = obj.Event[i].ResponseParameter.$.description;
                        }
                        else if(obj.Event[i].DispatchParameter){
                            event.ParametersType = 'DispatchParameter';
                            event.dataReference = obj.Event[i].DispatchParameter.$.datasetReference;
                            event.dataDescription = obj.Event[i].DispatchParameter.$.description;
                        }
                        this.Events.push(event);
                    }
                }
                else{
                    var event = {
                        name : obj.Event.$.name,
                        type : obj.Event.$.type,
                        optional : Boolean(obj.Event.$.optional),
                        description : obj.Event.$.description,
                        ParametersType : null,
                        dataReference : null,
                        dataDescription : ''
                    };
                    if (obj.Event.ResponseParameter){
                        event.ParametersType = 'ResponseParameter';
                        event.dataReference = obj.Event.ResponseParameter.$.datasetReference;
                        event.dataDescription = obj.Event.ResponseParameter.$.description;
                    }
                    else if(obj.Event.DispatchParameter){
                        event.ParametersType = 'DispatchParameter';
                        event.dataReference = obj.Event.DispatchParameter.$.datasetReference;
                        event.dataDescription = obj.Event.DispatchParameter.$.description;
                    }
                    this.Events.push(event);
                }
            }
        }
    } catch (error) {
        
    }
};

var Behavior = function(obj){
    this.RelatedDatasets = [];
    this.StateGroup = {
        States : [],
        StateTransitions : []
    };
    this.Parameters = {
        ProcessParameters : [],
        ControlParameters : []
    };

    try {
        if (obj.RelatedDatasets){
            if (obj.RelatedDatasets.DatasetItem){
                if (obj.RelatedDatasets.DatasetItem.length && typeof obj.RelatedDatasets.DatasetItem.length == 'number'){
                    for (var i = 0; i < obj.RelatedDatasets.DatasetItem.length; i++){
                        var dt = null;
                        if (obj.RelatedDatasets.DatasetItem[i].$.type == 'external'){
                            dt = {
                                name : obj.RelatedDatasets.DatasetItem[i].$.name,
                                type : obj.RelatedDatasets.DatasetItem[i].$.type,
                                description : obj.RelatedDatasets.DatasetItem[i].$.description,
                                externalId : obj.RelatedDatasets.DatasetItem[i].$.externalId
                            }
                        }
                        else if(obj.RelatedDatasets.DatasetItem[i].$.type == 'internal'){
                            dt = {
                                name : obj.RelatedDatasets.DatasetItem[i].$.name,
                                type : obj.RelatedDatasets.DatasetItem[i].$.type,
                                description : obj.RelatedDatasets.DatasetItem[i].$.description,
                                udxSchame : obj.RelatedDatasets.DatasetItem[i].UdxDeclaration
                            }
                        }
                        this.RelatedDatasets.push(dt);
                    }
                }
            }
        }
        if (obj.StateGroup){
            if(obj.StateGroup.States){
                if(obj.StateGroup.States.State){
                    if(obj.StateGroup.States.State.length && typeof obj.StateGroup.States.State.length == 'number'){
                        for (var i = 0; i < obj.StateGroup.States.State.length; i++){
                            var state = new State(obj.StateGroup.States.State[i]);
                            this.StateGroup.States.push(state);
                        }
                    }
                    else{
                        var state = new State(obj.StateGroup.States.State);
                        this.StateGroup.States.push(state);
                    }
                }
            }
            if (obj.StateGroup.StateTransitions){
                if (obj.StateGroup.StateTransitions.Add){
                    if (obj.StateGroup.StateTransitions.Add.length && typeof obj.StateGroup.StateTransitions.Add.length == 'number'){
                        for (var i = 0; i < obj.StateGroup.StateTransitions.Add.length; i++){
                            this.StateGroup.StateTransitions.push({
                                from : obj.StateGroup.StateTransitions.Add[i].from,
                                to : obj.StateGroup.StateTransitions.Add[i].to
                            });
                        }
                    }
                    else{
                        this.StateGroup.StateTransitions.push({
                            from : obj.StateGroup.StateTransitions.Add.from,
                            to : obj.StateGroup.StateTransitions.Add.to
                        });
                    }
                }
            }
        }
        if (obj.Parameters){
            if (obj.Parameters.ProcessParameters){
                if (obj.Parameters.ProcessParameters.Add){
                    if (obj.Parameters.ProcessParameters.Add.length && typeof obj.Parameters.Add.ProcessParameters == 'number'){
                        for (var i = 0; i < obj.Parameters.ProcessParameters.length; i++){
                            this.Parameters.ProcessParameters.push({
                                key : obj.Parameters.ProcessParameters.Add[i].$.key,
                                description : obj.Parameters.ProcessParameters.Add[i].$.description,
                                defaultValue : obj.Parameters.ProcessParameters.Add[i].$.defaultValue
                            });
                        }
                    }
                    else{
                        this.Parameters.ProcessParameters.push({
                            key : obj.Parameters.ProcessParameters.Add.$.key,
                            description : obj.Parameters.ProcessParameters.Add.$.description,
                            defaultValue : obj.Parameters.ProcessParameters.Add.$.defaultValue
                        });
                    }
                }
            }
            if (obj.Parameters.ControlParameters){
                if (obj.Parameters.ControlParameters.Add.length && typeof obj.Parameters.Add.ControlParameters == 'number'){
                    for (var i = 0; i < obj.Parameters.ControlParameters.Add.$.length; i++){
                        this.Parameters.ControlParameters.push({
                            key : obj.Parameters.ControlParameters.Add[i].$.key,
                            description : obj.Parameters.ControlParameters.Add[i].$.description,
                            defaultValue : obj.Parameters.ControlParameters.Add[i].$.defaultValue
                        });
                    }
                }
                else{
                    this.Parameters.ControlParameters.push({
                        key : obj.Parameters.ControlParameters.Add.$.key,
                        description : obj.Parameters.ControlParameters.Add.$.description,
                        defaultValue : obj.Parameters.ControlParameters.Add.$.defaultValue
                    });
                }
            }
        }
    } catch (error) {
        
    }
};

var Runtime = function(obj){
    this.name = '';
    this.version = '';
    this.baseDir = '';
    this.entry = '';
    this.HardwareConfigures = [];
    this.SoftwareConfigures = [];
    this.Assemblies = [];
    this.SupportiveResources = [];

    try {
        this.name = obj.$.name;
        this.version = obj.$.version;
        this.baseDir = obj.$.baseDir;
        this.entry = obj.$.entry;

        if (obj.HardwareConfigures){
            if (obj.HardwareConfigures.Add){
                if (obj.HardwareConfigures.Add.length && typeof obj.HardwareConfigures.Add.length == 'number'){
                    for (var i = 0; i < obj.HardwareConfigures.Add.length; i++){
                        this.HardwareConfigures.push({
                            key : obj.HardwareConfigures.Add[i].$.key,
                            value : obj.HardwareConfigures.Add[i].$.value
                        });
                    }
                }
                else{
                    this.HardwareConfigures.push({
                        key : obj.HardwareConfigures.Add.$.key,
                        value : obj.HardwareConfigures.Add.$.value
                    });
                }
            }
        }
        
        if (obj.SoftwareConfigures){
            if (obj.SoftwareConfigures.Add){
                if (obj.SoftwareConfigures.Add.length && typeof obj.SoftwareConfigures.Add.length == 'number'){
                    for (var i = 0; i < obj.SoftwareConfigures.Add.length; i++){
                        this.SoftwareConfigures.push({
                            key : obj.SoftwareConfigures.Add[i].$.key,
                            platform : obj.SoftwareConfigures.Add[i].$.platform,
                            value : obj.SoftwareConfigures.Add[i].$.value
                        });
                    }
                }
                else{
                    this.SoftwareConfigures.push({
                        key : obj.SoftwareConfigures.Add.$.key,
                        platform : obj.SoftwareConfigures.Add.$.platform,
                        value : obj.SoftwareConfigures.Add.$.value
                    });
                }
            }
        }
        
        if (obj.Assemblies){
            if (obj.Assemblies.Assembly){
                if (obj.Assemblies.Assembly.length && typeof obj.Assemblies.Assembly.length == 'number'){
                    for (var i = 0; i < obj.Assemblies.Assembly.length; i++){
                        this.Assemblies.push({
                            name : obj.Assemblies.Assembly[i].$.name,
                            path : obj.Assemblies.Assembly[i].$.path
                        });
                    }
                }
                else{
                    this.Assemblies.push({
                        name : obj.Assemblies.Assembly.$.name,
                        path : obj.Assemblies.Assembly.$.path
                    });
                }
            }
        }
        
        if (obj.SupportiveResources){
            if (obj.SupportiveResources.Add){
                if (obj.SupportiveResources.Add.length && typeof obj.SupportiveResources.Add.length == 'number'){
                    for (var i = 0; i < obj.SupportiveResources.Add.length; i++){
                        this.SupportiveResources.push({
                            type : obj.SupportiveResources.Add[i].$.type,
                            name : obj.SupportiveResources.Add[i].$.name
                        });
                    }
                }
                else{
                    this.SupportiveResources.push({
                        type : obj.SupportiveResources.Add.$.type,
                        name : obj.SupportiveResources.Add.$.name
                    });
                }
            }
        }
    } catch (error) {
        
    }
};

var MDLParser = function (){
    this.name = '';
    this.uid = '';
    this.style = '';
    this.AttributeSet = null;
    this.Behavior = null;
    this.Runtime = null;

};

MDLParser.prototype.loadFromXMLStream = function(xmlStream, callback){
    xmlparse(xmlStream, { explicitArray : false, ignoreAttrs : false }, function (err, json) {
        if (err){
            return callback(err);
        }
        try {
            this.name = json.ModelClass.$.name;
            this.uid = json.ModelClass.$.uid;
            this.style = json.ModelClass.$.style;
            this.AttributeSet = new AttributeSet(json.ModelClass.AttributeSet)
            this.Behavior = new Behavior(json.ModelClass.Behavior);
            this.Runtime = new Runtime(json.ModelClass.Runtime);
            return callback(null, this);
        } catch (error) {
            return callback(err);
        }
    });
};

MDLParser.prototype.loadFromJSONStream = function(jsStream, callback){
    try {
        var json = JSON.parse(jsStream);
        this.name = json.ModelClass.$.name;
        this.uid = json.ModelClass.$.uid;
        this.style = json.ModelClass.$.style;
        this.AttributeSet = new AttributeSet(json.ModelClass.AttributeSet)
        this.Behavior = new Behavior(json.ModelClass.Behavior);
        this.Runtime = new Runtime(json.ModelClass.Runtime);
        if(callback){
            return callback(null, this);
        }
    } catch (error) {
        if(callback){
            return callback(err);
        }
        return null;
    }
};



module.exports = MDLParser;