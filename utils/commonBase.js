/**
 * Created by Franklin on 2017/3/7.
 */

function ModelBase() {
    
}

ModelBase.returnFunction = function(callback, errMess)
{
    return (function (err, res) {
        if(err)
        {
            if(errMess != null && typeof errMess == "string")
            {
                console.log(errMess);
            }
            return callback(err,res);
        }
        res = JSON.parse(JSON.stringify(res));
        return callback(err,res);
    });
};

module.exports = ModelBase;