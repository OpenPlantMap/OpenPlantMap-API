var restify = require('restify');
var mongoose = require('mongoose');
var timestamp = require('mongoose-timestamp');
var fs = require('fs');
var GeoJSON = require('geojson');
var _ = require('lodash');
var products = require('./products');
var cfg = require('./config');
var json2csv = require('json2csv');
var Stream = require('stream');
var nodemailer = require('nodemailer');
var smtpTransport = require('nodemailer-smtp-transport');
var htmlToText = require('nodemailer-html-to-text').htmlToText;

var dbHost = process.env.DB_HOST || cfg.dbHost || 'db';

/*
 Logging
 */
var consoleStream = new Stream();
consoleStream.writable = true;
consoleStream.write = function (obj) {
    'use strict';
    if (obj.req) {
        console.log(obj.time, obj.req.remoteAddress, obj.req.method, obj.req.url);
    } else if (obj.msg) {
        console.log(obj.time, obj.msg);
    } //else {
    //console.log(obj.time, obj);
    //}
};

var Logger = require('bunyan'),
        reqlog = new Logger.createLogger({
            name: 'OSeM-API',
            streams: [
                {path: './request.log', type: 'rotating-file', period: '1w', count: 8},
                {level: 'debug', type: 'raw', stream: consoleStream}
            ],
            serializers: {
                err: Logger.stdSerializers.err,
                req: Logger.stdSerializers.req,
                res: Logger.stdSerializers.res
            }
        }),
        log = new Logger.createLogger({
            name: 'OSeM-API',
            streams: [
                {level: 'error', path: './request-error.log', type: 'rotating-file', period: '1w', count: 8},
                {level: 'debug', type: 'raw', stream: consoleStream}
            ],
            serializers: {
                err: Logger.stdSerializers.err,
                req: Logger.stdSerializers.req,
                res: Logger.stdSerializers.res
            }
        });

var server = restify.createServer({
    name: 'opensensemap-api',
    version: '0.0.1',
    log: reqlog
});
server.use(restify.CORS({'origins': ['*']})); //['http://localhost', 'https://opensensemap.org']}));
server.use(restify.fullResponse());
server.use(restify.queryParser());
server.use(restify.bodyParser());

// use this function to retry if a connection cannot be established immediately
var connectWithRetry = function () {
    'use strict';
    mongoose.connect('mongodb://' + dbHost + ':' + cfg.dbPort + '/' + cfg.dbName, {
        keepAlive: 1,
        user: cfg.dbuser,
        pass: cfg.dbuserpass,
        auth: {authdb: 'admin'}
    }, function (err) {
        if (err) {
            console.error('Failed to connect to mongo on startup with auth- try without', err);
            mongoose.disconnect();
            mongoose.connect('mongodb://' + dbHost + ':' + cfg.dbPort + '/' + cfg.dbName, {
                keepAlive: 1
            }, function (err) {
                if (err) {
                    console.error('Failed to connect to mongo on startup', err);
                } else {
                    console.log('Connected to mongo without password!');

                }
            });
        }
    });
};

connectWithRetry();

var Schema = mongoose.Schema;

//Location schema
var LocationSchema = new Schema({
    type: {
        type: String,
        required: true,
        default: 'Feature'
    },
    geometry: {
        type: {
            type: String,
            required: true,
            default: 'Point'
        },
        coordinates: {
            type: Array,
            required: true
        }
    },
    properties: Schema.Types.Mixed
});

LocationSchema.index({'geometry': '2dsphere'});

var measurementSchema = new Schema({
    value: {
        type: String,
        required: true
    },
    sensor_id: {
        type: Schema.Types.ObjectId,
        ref: 'Sensor',
        required: true
    }
});

measurementSchema.plugin(timestamp);

//Sensor schema
var sensorSchema = new Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    unit: {
        type: String,
        required: true,
        trim: true
    },
    sensorType: {
        type: String,
        required: false,
        trim: true
    },
    lastMeasurement: {
        type: Schema.Types.ObjectId,
        ref: 'Measurement'
    }
});

//SenseBox schema
var boxSchema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    loc: {
        type: [LocationSchema],
        required: true
    },
    boxType: {
        type: String,
        required: true
    },
    exposure: {
        type: String,
        required: false
    },
    grouptag: {
        type: String,
        required: false
    },
    model: {
        type: String,
        required: false
    },
    sensors: [sensorSchema]
}, {strict: false});

var userSchema = new Schema({
    firstname: {
        type: String,
        required: true,
        trim: true
    },
    lastname: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        trim: true
    },
    apikey: {
        type: String,
        trim: true
    },
    boxes: [
        {
            type: String,
            trim: true
        }
    ]
});
var planttypeSchema = new Schema({
  name:[String],
  latinName: {
    type: String,
    required: true
  },
  phCondition: {
    min: Number,
    max: Number
  },
  moistureCondition: {
    dry: String,
	medium: String,
	wet: String
  },
  sunLightCondition: {
    sunny: String,
	semishady: String,
	shady: String
  },
  temperatureCondition: {
    min: Number,
    max: Number
  },
  image:String
});
var plantSchema = new Schema({
 plantType:{
    type: Schema.Types.ObjectId,
    ref: 'Planttype',
    required: true
  },
  loc: {
    type: Array,
    required: true
  },
  image:String
});

var Measurement = mongoose.model('Measurement', measurementSchema);
var Box = mongoose.model('Box', boxSchema);
var Sensor = mongoose.model('Sensor', sensorSchema);
var User = mongoose.model('User', userSchema);
var Planttype = mongoose.model('Planttype', planttypeSchema);
var Plant = mongoose.model('Plant', plantSchema);

/*jshint -W098*/

var PATH = '/boxes';
var userPATH = 'users';
var PATH_plants = '/plants';
var PATH_plantTypes = '/planttypes';


server.pre(function (request, response, next) {
    'use strict';
    request.log.info({req: request}, 'REQUEST');
    next();
});

server.get({path : PATH , version : '0.0.1'} , findAllBoxes);
server.get({path : /(boxes)\.([a-z]+)/, version : '0.0.1'} , findAllBoxes);
server.get({path : PATH +'/:boxId' , version : '0.0.1'} , findBox);
server.get({path : PATH +'/:boxId/sensors', version : '0.0.1'}, getMeasurements);
server.get({path : PATH +'/:boxId/data/:sensorId', version : '0.0.1'}, getData);
server.get({path: PATH_plants, version : '0.0.1'}, findAllPlants);
server.get({path: PATH_plants +'/:plantId', version : '0.0.1'}, findPlant);
server.get({path: PATH_plantTypes, version : '0.0.1'}, findAllPlantTypes);
server.get({path: PATH_plantTypes + '/:planttypeId', version: '0.0.1'}, findPlantType);
server.get({path: PATH_plantTypes + 'by/:latinname', version: '0.0.1'}, getPlantTypeByLatinName);
server.get({path: PATH_plantTypes + 'bycommon/:name', version: '0.0.1'}, getPlantTypeByCommonName);
server.get({path: PATH_plants +'byType/:planttypeId', version: '0.0.1'}, getAllPlantsByTypeId);
server.get({path: '/planttypesIDs', version: '0.0.1'},getAllPlanttypes);

server.post({path : PATH , version: '0.0.1'} ,postNewBox);
server.post({path : PATH +'/:boxId/:sensorId' , version : '0.0.1'}, postNewMeasurement);
server.post({path: PATH_plants +'/:planttypeId', version : '0.0.1'}, postNewPlant);
server.post({path: PATH_plantTypes +'/:latinName/:commonNames/:pH_min/:pH_max/:mois_dry/:mois_med/:mois_wet/:temp_min/:temp_max/:sun_sunny/:sun_semi/:sun_shady', version : '0.0.1'}, postNewPlantType);

server.get({path: userPATH + '/:boxId', version: '0.0.1'}, validApiKey);

server.get({path: '/boxes/:boxId/conditions/:measurement', version: '0.0.1'}, getConditions);

function unknownMethodHandler(req, res) {
    'use strict';
    if (req.method.toLowerCase() === 'options') {
        var allowHeaders = ['Accept', 'X-ApiKey', 'Accept-Version',
            'Content-Type', 'Api-Version', 'Origin', 'X-Requested-With']; // added Origin & X-Requested-With

        if (res.methods.indexOf('OPTIONS') === -1) {
            res.methods.push('OPTIONS');
        }

        res.header('Access-Control-Allow-Credentials', true);
        res.header('Access-Control-Allow-Headers', allowHeaders.join(', '));
        res.header('Access-Control-Allow-Methods', res.methods.join(', '));
        res.header('Access-Control-Allow-Origin', req.headers.origin);

        return res.send(204);
    } else {
        return res.send(new restify.MethodNotAllowedError());
    }

}

server.on('MethodNotAllowed', unknownMethodHandler);

/**
 * @api {get} /boxes/users/:boxId Check for valid API key
 * @apiDescription Check for valid API key. Will return status code 400 if invalid, 200 if valid.
 * @apiParam {ID} boxId SenseBox unique ID.
 * @apiHeader {ObjectId} x-apikey SenseBox specific apikey
 * @apiHeaderExample {json} Request-Example:
 *   {
 *     'X-ApiKey':54d3a96d5438b4440913434b
 *   }
 * @apiError {String} ApiKey is invalid!
 * @apiError {String} ApiKey not existing!
 * @apiSuccess {String} ApiKey is valid!
 * @apiVersion 0.0.1
 * @apiGroup Boxes
 * @apiName updateBox
 */
function validApiKey(req, res, next) {
    'use strict';
    User.findOne({apikey: req.headers['x-apikey']}, function (error, user) {
        if (error) {
            res.send(400, 'ApiKey not existing!');
        }

        if (user.boxes.indexOf(req.params.boxId) !== -1) {
            res.send(200, 'ApiKey is valid!');
        } else {
            res.send(400, 'ApiKey is invalid!');
        }
    });
}

function decodeBase64Image(dataString) {
    'use strict';
    var matches = dataString.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/),
            response = {};

    if (matches.length !== 3) {
        return new Error('Invalid input string');
    }

  response.type = matches[1];
  response.data = new Buffer(matches[2], 'base64');
  return response;
}

/**
 * @api {put} /boxes/:boxId Update a SenseBox
 * @apiDescription Modify the specified SenseBox.
 * @apiParam {ID} boxId SenseBox unique ID.
 * @apiHeader {ObjectId} x-apikey SenseBox specific apikey
 * @apiHeaderExample {json} Request-Example:
 *   {
 *     'X-ApiKey':54d3a96d5438b4440913434b
 *   }
 * @apiVersion 0.0.1
 * @apiGroup Boxes
 * @apiName updateBox
 */
function updateBox(req, res, next) {
    'use strict';
    User.findOne({apikey: req.headers['x-apikey']}, function (error, user) {
        if (error) {
            res.send(400, 'ApiKey not existing!');
        }
        if (user.boxes.indexOf(req.params.boxId) !== -1) {
            Box.findById(req.params.boxId, function (err, box) {
                if (err) {
                    return next(new restify.InvalidArgumentError(JSON.stringify(err.errors)));
                }
                log.debug(req.params);
                if (req.params.tmpSensorName !== undefined) {
                    box.set({name: req.params.tmpSensorName});
                }
                if (req.params.image !== undefined) {
                    var data = req.params.image.toString();
                    var imageBuffer = decodeBase64Image(data);
                    fs.writeFile(cfg.imageFolder + ' ' + req.params.boxId + '.jpeg', imageBuffer.data, function (err) {
                        if (err) {
                            return new Error(err);
                        }
                        box.set({image: req.params.boxId + '.jpeg'});
                        box.save(function (err) {
                            if (err) {
                                return next(new restify.InvalidArgumentError(JSON.stringify(err.errors)));
                            }
                            res.send(box);
                        });
                    });
                } else {
                    box.set({image: ''});
                }
                box.save(function (err) {
                    if (err) {
                        return next(new restify.InvalidArgumentError(JSON.stringify(err.errors)));
                    }
                    res.send(box);
                });
            });
        } else {
            res.send(400, 'ApiKey does not match SenseBoxID');
        }
    });
}

/**
 * @api {get} /boxes/:boxId/sensors Get all last measurements
 * @apiDescription Get last measurements of all sensors of the secified SenseBox.
 * @apiVersion 0.0.1
 * @apiGroup Measurements
 * @apiName getMeasurements
 * @apiParam {ID} boxId SenseBox unique ID.
 */
function getMeasurements(req, res, next) {
    'use strict';
    Box.findOne({_id: req.params.boxId}, {sensors: 1}).populate('sensors.lastMeasurement').exec(function (error, sensors) {
        if (error) {
            return next(new restify.InvalidArgumentError(JSON.stringify(error.errors)));
        } else {
            res.send(201, sensors);
        }
    });
}

function getPlantTypeByCommonName(req,res,next){
	Planttype.findOne({name: req.params.name}).populate('').exec(function(error, planttype){
		if (error){
			return next(new resify.InvalidArgumentError(JSON.stringify(error.errors)));
		} else {
			log.debug(req.params.name + " succesfully found in database.");
			res.send(201,planttype);
		}
	});
}

function getPlantTypeByLatinName(req, res, next){
	Planttype.findOne({latinName: req.params.latinname}).populate('').exec(function(error, planttype){
		if (error){
			return next(new resify.InvalidArgumentError(JSON.stringify(error.errors)));
		} else {
			log.debug(req.params.latinname + " succesfully found in database.");
			res.send(201,planttype);
		}
	});
}

function getAllPlantsByTypeId(req, res, next){
	Plant.find({plantType: req.params.planttypeId}).populate('').exec(function(error, plants){
		if (error){
			console.log("error: "+error);
			return next(new resify.InvalidArgumentError(JSON.stringify(error.errors)));
		} else {
			log.debug("sucessfully found all plants of PlanttypeId "+ req.params.planttypeId+".");
			res.send(201,plants);
		}
	});
}


function getAllPlanttypes(req, res, next){
    Planttype.find({},{"_ID":1, "latinName":1}).populate('').exec(function(error,planttypes){
        if (error) {
        	res.send(400, error);
		}
        res.send(200, planttypes);
    });
}
/**
 * @api {get} /boxes/:boxId/data/:sensorId?from-date=:fromDate&to-date:toDate Get last n measurements for a sensor
 * @apiDescription Get up to 1000 measurements from a sensor for a specific time frame, parameters `from-date` and 
 * `to-date` are optional. If not set, the last 24 hours are used. 
 * The maximum time frame is 1 month. A maxmimum of 1000 values wil be returned for each request.
 * @apiVersion 0.0.1
 * @apiGroup Measurements
 * @apiName getData
 * @apiParam {ID} boxId SenseBox unique ID.
 * @apiParam {ID} sensorId Sensor unique ID.
 * @apiParam {String} from-date Beginning date of measurement data (default: 24 hours ago from now)
 * @apiParam {String} to-date End date of measurement data (default: now)
 * @apiParam {String} download If set, offer download to the user (default: false, always on if CSV is used)
 * @apiParam {String} format Can be 'JSON' (default) or 'CSV' (default: JSON)
 */
function getData(req, res, next) {
    'use strict';
    // default to now
    var toDate = (typeof req.params['to-date'] === 'undefined' || req.params['to-date'] === '') ? new Date() : new Date(req.params['to-date']);
    // default to 24 hours earlier
    var fromDate = (typeof req.params['from-date'] === 'undefined' || req.params['from-date'] === '') ? new Date(toDate.valueOf() - 1000 * 60 * 60 * 24 * 15) : new Date(req.params['from-date']);
    var format = (typeof req.params['format'] === 'undefined') ? 'json' : req.params['format'].toLowerCase();

    log.debug(fromDate, 'to', toDate);

    if (toDate.valueOf() < fromDate.valueOf()) {
        return next(new restify.InvalidArgumentError(JSON.stringify('Invalid time frame specified')));
    }
    if (toDate.valueOf() - fromDate.valueOf() > 1000 * 60 * 60 * 24 * 32) {
        return next(new restify.InvalidArgumentError(JSON.stringify('Please choose a time frame up to 31 days maximum')));
    }

    var queryLimit = 100000;
    var resultLimit = 1000;

    Measurement.find({
        sensor_id: req.params.sensorId,
        createdAt: {$gte: new Date(fromDate), $lte: new Date(toDate)}
    }, {'createdAt': 1, 'value': 1, '_id': 0}) // do not send _id column
            .limit(queryLimit)
            .lean()
            .exec(function (error, sensorData) {
                if (error) {
                    return next(new restify.InvalidArgumentError(JSON.stringify(error.errors)));
                } else {
                    // only return every nth element
                    // TODO: equally distribute data over time instead
                    if (sensorData.length > resultLimit) {
                        var limitedResult = [];
                        var returnEveryN = Math.ceil(sensorData.length / resultLimit);
                        log.info('returnEveryN ', returnEveryN);
                        log.info('old sensorData length:', sensorData.length);
                        for (var i = 0; i < sensorData.length; i++) {
                            if (i % returnEveryN === 0) {
                                limitedResult.push(sensorData[i]);
                            }
                        }
                        sensorData = limitedResult;
                        log.info('new sensorData length:', sensorData.length);
                    }

                    if (typeof req.params['download'] !== 'undefined' && req.params['download'] === 'true') {
                        // offer download to browser
                        res.header('Content-Disposition', 'attachment; filename=' + req.params.sensorId + '.' + format);
                    }

                    if (format === 'csv') {
                        // send CSV
                        json2csv({data: sensorData, fields: ['createdAt', 'value']}, function (err, csv) {
                            if (err) {
                                log.error(err);
                            }
                            res.header('Content-Type', 'text/csv');
                            res.header('Content-Disposition', 'attachment; filename=' + req.params.sensorId + '.csv');
                            res.send(201, csv);
                        });
                    } else {
                        // send JSON
                        res.send(201, sensorData);
                    }

                }
            });
}

/**
* @api {post} planttypes/:latinName/:commonNames/:pH_min/:pH_max/:mois_dry/:mois_med/:mois_wet/:temp_min/:temp_max/:sun_sunny/:sun_semi/:sun_shady
* @apiDescription inserts a new plantType into the database.
* @apiVersion 0.0.1
* @apiGroup Planttypes
* @apiName postNewPlantType
* @apiParam {name} Array of common names for the plant type
* @apiParam {latinName} String of the specific latin name for the plant type
* @apiParam {pHCondition} pH Condition Min and Max value for the plant type
* @apiParam {moistureCondition} moisture Condition wet, medium, dry value for the plant type
* @apiParam {sunlightCondition} sunlight Condition sunny, semi-shady, shady value for the plant type
* @apiParam {temperatureCondition} temperature Condition Min and Max value for the plant type
*/
function postNewPlantType(req, res, next){
	var json = JSON.parse(req.body);
	newPlantTypeData = {
		name :[],
		latinName: req.params.latinName,
		phCondition: {
			min: req.params.pH_min,
			max: req.params.pH_max
		}, 
		moistureCondition: {
			dry: req.params.mois_dry,
			medium: req.params.mois_med,
			wet: req.params.mois_wet,
		},
		sunLightCondition: {
			sunny: req.params.sun_sunny,
			semishady: req.params.sun_semi,
			shady: req.params.sun_shady,
		},
		temperatureCondition: {
			min: req.params.temp_min,
			max: req.params.temp_max
		},
		image:json.image
	};

	var imageBuffer = decodeBase64Image(json.image);
	req.params.commonNames.split('ZZZ').forEach(function (line) {
		newPlantTypeData.name.push(line);
	});
	
	newPlantType = new Planttype(newPlantTypeData);
	
	newPlantType.save(function(err){
		if (err) return next(new restify.InvalidArgumentError(JSON.stringify(err.errors)));
		var fileName = cfg.imageFolder + "" + newPlantType._id + '.jpeg';
		fs.writeFile(fileName, imageBuffer.data, function(error){
			if (error) log.debug(error);
			log.debug("PlantType-ImageFile successfully created on server.");
		});
		res.send(201, newPlantType._id);
		log.debug("PlantType successfully saved in database.");
	});
}

/**
 * @api {post} /boxes/:boxId/:sensorId Post new measurement
 * @apiDescription Posts a new measurement to a specific sensor of a box.
 * @apiVersion 0.0.1
 * @apiGroup Measurements
 * @apiName postNewMeasurement
 * @apiParam {ID} boxId SenseBox unique ID.
 * @apiParam {ID} sensorId Sensors unique ID.
 */
function postNewMeasurement(req, res, next) {
    'use strict';
    Box.findOne({_id: req.params.boxId}, function (error, box) {
        if (error) {
            return next(new restify.InvalidArgumentError(JSON.stringify(error.errors)));
        } else {
            for (var i = box.sensors.length - 1; i >= 0; i--) {
                if (box.sensors[i]._id.equals(req.params.sensorId)) {

                    var measurementData = {
                        value: req.params.value,
                        _id: mongoose.Types.ObjectId(),
                        sensor_id: req.params.sensorId
                    };

                    var measurement = new Measurement(measurementData);

                    box.sensors[i].lastMeasurement = measurement._id;
                    /*jshint -W083 */
                    box.save(function (error, data) {
                        if (error) {
                            return next(new restify.InvalidArgumentError(JSON.stringify(error.errors)));
                        } else {
                            measurement.save(function (error, data) {
                                if (error) {
                                    return next(new restify.InvalidArgumentError(JSON.stringify(error.errors)));
                                } else {
                                    res.send(201, data);
                                }
                            });
                        }
                    });
                    /*jshint +W083 */
                }
            }
        }
    });
}

/**
 * @api {get} /boxes Get all SenseBoxes
 * @apiName findAllBoxes
 * @apiGroup Boxes
 * @apiVersion 0.0.1
 * @apiSampleRequest http://opensensemap.org:8000/boxes
 */
function findAllBoxes(req, res, next) {
    'use strict';
    Box.find({}).populate('sensors.lastMeasurement').exec(function (err, boxes) {
        if (req.params[1] === 'json' || req.params[1] === undefined) {
            res.send(boxes);
        } else if (req.params[1] === 'geojson') {
            var tmp = JSON.stringify(boxes);
            tmp = JSON.parse(tmp);
            var geojson = _.transform(tmp, function (result, n) {
                var lat = n.loc[0].geometry.coordinates[1];
                var lng = n.loc[0].geometry.coordinates[0];
                delete n['loc'];
                n['lat'] = lat;
                n['lng'] = lng;
                return result.push(n);
            });
            res.send(GeoJSON.parse(geojson, {Point: ['lat', 'lng']}));
        }
    });
}

/**
 * @api {get} /boxes/:boxId Get one SenseBox
 * @apiName findBox
 * @apiVersion 0.0.1
 * @apiGroup Boxes
 * @apiParam {ID} boxId SenseBox unique ID.
 * @apiSuccess {String} _id SenseBox unique ID.
 * @apiSuccess {String} boxType SenseBox type (fixed or mobile).
 * @apiSuccess {Array} sensors All attached sensors.
 * @apiSuccess {Array} loc Location of SenseBox.
 * @apiSuccessExample Example data on success:
 * {
 "_id": "5386e44d5f08822009b8b614",
 "name": "PHOBOS",
 "boxType": "fixed",
 "sensors": [
 {
 "_id": "5386e44d5f08822009b8b615",
 "boxes_id": "5386e44d5f08822009b8b614",
 "lastMeasurement": {
 "_id": "5388d07f5f08822009b937b7",
 "createdAt": "2014-05-30T18:39:59.353Z",
 "updatedAt": "2014-05-30T18:39:59.353Z",
 "value": "584",
 "sensor_id": "5386e44d5f08822009b8b615",
 },
 "sensorType": "GL5528",
 "title": "Helligkeit",
 "unit": "Pegel"
 }
 ],
 "loc": [
 {
 "_id": "5386e44d5f08822009b8b61a",
 "geometry": {
 "coordinates": [
 10.54555893642828,
 49.61361673283691
 ],
 "type": "Point"
 },
 "type": "feature"
 }
 ]
 }
 */
function findBox(req, res, next) {
    'use strict';
    var id = req.params.boxId.split('.')[0];
    var format = req.params.boxId.split('.')[1];
    //if (isEmptyObject(req.query)) {
    Box.findOne({_id: id}).populate('sensors.lastMeasurement').exec(function (error, box) {
        if (error) {
            return next(new restify.InvalidArgumentError(JSON.stringify(error.errors)));
        }
        if (box) {
            if (format === 'json' || format === undefined) {
                res.send(box);
            } else if (format === 'geojson') {
                var tmp = JSON.stringify(box);
                tmp = JSON.parse(tmp);
                var lat = tmp.loc[0].geometry.coordinates[1];
                var lng = tmp.loc[0].geometry.coordinates[0];
                delete tmp['loc'];
                tmp['lat'] = lat;
                tmp['lng'] = lng;
                var geojson = [tmp];
                res.send(GeoJSON.parse(geojson, {Point: ['lat', 'lng']}));
            }
        } else {
            res.send(404);
        }
    });
    //} else {
    //    res.send(box);
    //}
}




/**
 * @api {get} /planttypes/:planttypeId Get One Planttype
 * @apiName findPlantType
 * @apiGroup Planttypes
 * @apiVersion 0.0.1
 * @apiParam {ID} planttypeId Planttype unique ID.
 * @apiSampleRequest http://opensensemap.org:8000/planttypes/569e3482d2c2658023d28fbc
 */
function findPlantType(req, res, next){
	Planttype.findOne({_id: req.params.planttypeId}).populate('').exec(function(error, planttype){
		if (error){
			return next(new resify.InvalidArgumentError(JSON.stringify(error.errors)));
		} else {
			log.debug(req.params.id + " succesfully found in database.");
			res.send(201,planttype);
		}
	});
}

/**
 * @api {get} /planttypes Get all Plant Types
 * @apiName findAllPlantTypes 
 * @apiGroup Plants
 * @apiVersion 0.0.1
 * @apiSampleRequest http://opensensemap.org:8000/planttypes
 */
function findAllPlantTypes(req, res, next){
	Planttype.find({}).populate('').exec(function(err,planttypes){
		res.send(planttypes);
	});
}

/**
 * @api {get} /plants/:plantId Get One Plant
 * @apiName findPlant
 * @apiGroup Planta
 * @apiVersion 0.0.1
 * @apiParam {ID} plantId Plant unique ID.
 * @apiSampleRequest http://opensensemap.org:8000/plant/569e3482d2c2658023d28fbc
 */
function findPlant(req,res,next){
	Plant.findOne({_id: req.params.plantId}).populate('').exec(function(error, plant){
		if (error){
			return next(new resify.InvalidArgumentError(JSON.stringify(error.errors)));
		} else {
			log.debug(req.params.id + " succesfully found in database.");
			res.send(201,plant);
		}
	});
}

/**
 * @api {get} /plants Get all Plant Types
 * @apiName findAllPlant
 * @apiGroup Plants
 * @apiVersion 0.0.1
 * @apiSampleRequest http://opensensemap.org:8000/plants
 */
function findAllPlants(req,res,next){
	Plant.find({}).populate('').exec(function(err,plants){
		res.send(plants);
	});
}

/**
* @api {post} plants/:planttypeId
* @apiDescription inserts a new plant into the database.
* @apiVersion 0.0.1
* @apiGroup Plants
* @apiName postNewPlant
* @apiParam {planttypeId} planttypeId Planttype specified by its planttypeID of the new posted plant
*/
function postNewPlant(req,res,next){
	var json = JSON.parse(req.body);
	newPlantData = {
		plantType: req.params.planttypeId,
		loc: json.loc,
		image:json.image
	};
	var imageBuffer = decodeBase64Image(json.image);

	newPlant = new Plant(newPlantData);

	newPlant.save(function(err){

		if (err) return next(new restify.InvalidArgumentError(JSON.stringify(err.errors)));
		var fileName = cfg.imageFolder+ "" + newPlant._id + '.jpeg';
		//newPlant.image = newPlant._id + '.jpeg';
		fs.writeFile(fileName, imageBuffer.data, function(error){
			if (error) log.debug(error);
			log.debug("Plant-ImageFile successfully created on server.");
		});
		res.send(201, newPlant);
		log.debug("Plant successfully saved in database.");
	});
}

function createNewUser (req) {
    'use strict';
  var userData = {
    firstname: req.params.user.firstname,
    lastname: req.params.user.lastname,
    email: req.params.user.email,
    apikey: req.params.orderID,
    boxes: []
  }

    var user = new User(userData);

    return user;
}

function createNewBox(req) {
    'use strict';
    var boxData = {
        name: req.params.name,
        boxType: req.params.boxType,
        loc: req.params.loc,
        grouptag: req.params.tag,
        exposure: req.params.exposure,
        _id: mongoose.Types.ObjectId(),
        sensors: []
    };

    var box = new Box(boxData);

    if (req.params.model) {
        switch (req.params.model) {
            case 'homeEthernet':
                req.params.sensors = products.senseboxhome;
                break;
            case 'basicEthernet':
                req.params.sensors = products.senseboxbasic;
                break;
            default:
                break;
        }
    }

    for (var i = req.params.sensors.length - 1; i >= 0; i--) {
        var id = mongoose.Types.ObjectId();

        var sensorData = {
            _id: id,
            title: req.params.sensors[i].title,
            unit: req.params.sensors[i].unit,
            sensorType: req.params.sensors[i].sensorType
        };

        box.sensors.push(sensorData);
    }

    return box;
}
//customize ino-file-line
function customizeInoFileLine(line, output, box) {
    'use strict';
    /* jshint ignore:start */
    if (line.indexOf('//SenseBox ID') !== -1) {
        fs.appendFileSync(output, line.toString() + '\n');
        fs.appendFileSync(output, '#define SENSEBOX_ID ' + box._id + '"\n');
    } else if (line.indexOf('//Sensor IDs') !== -1) {
        fs.appendFileSync(output, line.toString() + '\n');
        var customSensorindex = 1;
        for (var i = box.sensors.length - 1; i >= 0; i--) {
            var sensor = box.sensors[i];
            log.debug(sensor);
            if (sensor.title === 'Temperatur') {
                fs.appendFileSync(output, '#define TEMPSENSOR_ID "' + sensor._id + '"\n');
            } else if (sensor.title === 'rel. Luftfeuchte') {
                fs.appendFileSync(output, '#define HUMISENSOR_ID "' + sensor._id + '"\n');
            } else if (sensor.title === 'Luftdruck') {
                fs.appendFileSync(output, '#define PRESSURESENSOR_ID "' + sensor._id + '"\n');
            } else if (sensor.title === 'Lautstärke') {
                fs.appendFileSync(output, '#define NOISESENSOR_ID "' + sensor._id + '"\n');
            } else if (sensor.title === 'Helligkeit') {
                fs.appendFileSync(output, '#define LIGHTSENSOR_ID "' + sensor._id + '"\n');
            } else if (sensor.title === 'Beleuchtungsstärke') {
                fs.appendFileSync(output, '#define LUXSENSOR_ID "' + sensor._id + '"\n');
            } else if (sensor.title === 'UV-Intensität') {
                fs.appendFileSync(output, '#define UVSENSOR_ID "' + sensor._id + '"\n');
            } else {
                fs.appendFileSync(output, '#define SENSOR' + customSensorindex + '_ID "' + sensor._id + '" \/\/ ' + sensor.title + ' \n');
                customSensorindex++;
            }
        }
    } else {
        fs.appendFileSync(output, line.toString() + '\n');
    }
    /* jshint ignore:end */
}
/**
 * @api {post} /boxes Post new SenseBox
 * @apiDescription Create a new SenseBox.
 * @apiVersion 0.0.1
 * @apiGroup Boxes
 * @apiName postNewBox
 */
function postNewBox(req, res, next) {
    'use strict';
    User.findOne({apikey: req.params.orderID}, function (err, user) {
        if (err) {
            log.error(err);
            return res.send(500);
        } else {

            log.debug('A new sensebox is being submitted');
            //log.debug(req.params);
            if (!user) {
                var newUser = createNewUser(req);
                var newBox = createNewBox(req);
                var savedBox = {};

                newUser._doc.boxes.push(newBox._doc._id.toString());
                newBox.save(function (err, box) {
                    if (err) {
                        return next(new restify.InvalidArgumentError(JSON.stringify(err.errors)));
                    }
                    var filename = '';
                    switch (req.params.model) {
                        case 'homeEthernet':
                            filename = cfg.pathToApp + 'files/template_home/template_home.ino';
                            break;
                        case 'basicEthernet':
                            filename = cfg.pathToApp + 'files/template_basic/template_basic.ino';
                            break;
                        default:
                            filename = cfg.pathToApp + 'files/template_custom_setup/template_custom_setup.ino';
                            break;
                    }

                    try {
                        var output = cfg.targetFolder + '' + box._id + '.ino';
                        log.debug(output);

                        fs.readFileSync(filename).toString().split('\n').forEach(function (line) {
                            customizeInoFileLine(line, output, box);
                        });

                        savedBox = box;

                        newUser.save(function (err, user) {
                            if (err) {
                                return next(new restify.InvalidArgumentError(JSON.stringify(err.errors)));
                            } else {
                                sendWelcomeMail(user, newBox);
                                return res.send(201, user);
                            }
                        });

                    } catch (e) {
                        log.error(e);
                        return res.send(500, JSON.stringify('An error occured'));
                    }


                });
            }
        }
    });
    next();
}



// Send box script to user via email
function sendWelcomeMail(user, box) {
    'use strict';
    var templatePath = cfg.pathToApp + 'templates/registration.html';
    var templateContent = fs.readFileSync(templatePath, 'utf8');
    var template = _.template(templateContent);
    var compiled = template({'user': user, 'box': box});

    var transporter = nodemailer.createTransport(smtpTransport({
        host: cfg.email.host,
        port: cfg.email.port,
        secure: cfg.email.secure,
        auth: {
            user: cfg.email.user,
            pass: cfg.email.pass
        },
        tls: cfg.email.tls
    }));
    transporter.use('compile', htmlToText());
    transporter.sendMail({
        from: {
            name: cfg.email.fromName,
            address: cfg.email.fromEmail
        },
        replyTo: {
            name: cfg.email.fromName,
            address: cfg.email.replyTo
        },
        to: {
            name: user.firstname + ' ' + user.lastname,
            address: user.email
        },
        subject: cfg.email.subject,
        template: 'registration',
        html: compiled,
        attachments: [
            {
                filename: 'sensebox.ino',
                path: cfg.targetFolder + box._id + '.ino'
            }
        ]
    }, function (err, info) {
        if (err) {
            log.error('Email error');
            log.error(err);
        }
        if (info) {
            log.debug('Email sent successfully');
        }
    });
}

//function isEmptyObject(obj) {
//    'use strict';
//    return !Object.keys(obj).length;
//}

server.listen(cfg.serverPort, cfg.serverHost, function () {
    'use strict';
    console.log('%s listening at %s', server.name, server.url);
});

server.on('uncaughtException', function (req, res, route, err) {
    'use strict';
    log.error('Uncaught error', err);
    return res.send(500, JSON.stringify('An error occured'));
});



/**
 * @api {get} /boxes/:boxId/conditions/:measurement?bound=:bound&months=:months&hours=:hours Get percentages for each interval 
 * @apiDescription Get the percentages and hours for a measurement of one box for each interval.
 * @apiParam {ID} boxId SenseBox unique ID.
 * @apiParam {String} measurement Name of the measurement. One of: light, moisture, ph-value, temperature
 * @apiParam {Number} bound value which divide the measurement values into different classes. Example: [0,100,200,400]
 * @apiParam {String} months Interval of months. (Jan=1,Feb=2,...) Example: 2-5, or 10-2
 * @apiParam {String} hours Two numbers between [0-23] examples: 8-16 or 16-8
 * @apiError {String} boxId boxId does not exist in the database.
 * @apiError {String} measurement Measurement name not allowed.
 * @apiError {String} bounds Format for bounds has to be an Array of numbers or one single number.
 * @apiError {String} bounds_ The numbers for the bounds need to be sorted from small to big.
 * @apiError {String} month Format for month not correct. It has to be like: 2-5, or 10-2.
 * @apiError {String} month_ Numbers for months not correct. The value has to be between [1-12]. (Jan=1,Feb=2,...)
 * @apiError {String} hours Format for hours not correct. It has to be like: 0-23.
 * @apiError {String} hours_ Start-hour/ end-hour needs a value between 0-23.
 * @apiSuccess {ObjectID} _id ObjectId of the box.
 * @apiSuccess {String} name Name of the measurement (Light, soil_temp, moisture, ph_value)
 * @apiSuccess {Array} intervals An interval object contains the interval bounds, the calculated value in % and the computed hours for that interval
 * @apiVersion 0.0.1
 * @apiGroup Conditions
 * @apiName GetIntervalPercentagesForOneMeasurement
 * @apiSuccessExample Example data on success:
 * {
  "_id": "5386e44d5f08822009b8b614",
  "name": "Light",
  "intervals": [
  {
      "value_start": "0",
      "value_end": "100",
      "percentage": "58",
      "hours": "6:00",
    },
   {
      "value_start": "100",
      "value_end": "200",
      "percentage": "42",
      "hours": "4:20",
    },
    {
      "value_start": "200",
      "value_end": "400",
      "percentage": "20",
      "hours": "2:10",
    }
  ]
}
 */
function getConditions(req, res, next) {
    'use strict';
    var bounds = req.params.bound.sort(function (a, b) {
        return a - b
    });
    var measurement = req.params.measurement;
    var data = {};
    var index = 0;

    Box.findOne({_id: req.params.boxId}, function (err, box) {
        if (err) {
            return next(new restify.InvalidArgumentError(JSON.stringify(err.errors)));
        }
        var i;
        for (i = 0; i < box.sensors.length; i++) {
            if (box.sensors[i].title === measurement) {
                var sensorId = box.sensors[i]._id;
                Measurement.aggregate(
                        {$match: {sensor_id: sensorId}},
                        {$group: {_id: '$sensor_id',
                                count: {$sum: 1}}},
                        function (err, info) {
                            data.sensor_id = sensorId;
                            data.measurement = measurement;
                            data.count = info[0].count;
                            countValuesInInterval(sensorId, bounds, index, data, res);
                        });
                break;
            }
        }
        if (i === (box.sensors.length)) {
            return res.send("no such measurement found");
        }
    });
}
function countValuesInInterval(sensorId, bounds, index, data, res) {
    var interval;
    var start;
    var end;
    if (typeof bounds[index - 1] === "undefined" && typeof bounds[index] !== "undefined") {
        interval = {$lt: Number(bounds[index])};
        start = "";
        end = Number(bounds[index]);
    } else {
        if (typeof bounds[index - 1] !== "undefined" && typeof bounds[index] === "undefined") {
            interval = {$gt: Number(bounds[index - 1])};
            start = Number(bounds[index - 1]);
            end = "";
        }
        if (typeof bounds[index - 1] !== "undefined" && typeof bounds[index] !== "undefined") {
            interval = {$gt: Number(bounds[index - 1]), $lt: Number(bounds[index])};
            start = Number(bounds[index - 1]);
            end = Number(bounds[index]);
        }
    }
    return Measurement.aggregate(
            {$match: {sensor_id: sensorId, value: interval}},
            {$group: {_id: '$sensor_id',
                    values: {$push: '$value'},
                    count: {$sum: 1}}},
            {$project: {_id: 0, values: 1, count: 1, interval_start: {$literal: start}, interval_end: {$literal: end}}},
            function (err, interval) {
                if(err){
                    res.send(err);
                }
                data[index] = interval;
                if (data[index].length !== 0 && data.count !== 0) {
                    data[index][0].percentage = (data[index][0].count / data.count)*100;
                }
                if (index !== (bounds.length)) {
                    index = index + 1;
                    return  countValuesInInterval(sensorId, bounds, index, data, res);
                } else {

                    res.send(data);
                }

            });
}

//                var m = new Measurement({"sensor_id": "56b0ec3174cc57d12ce407fc", "value": 200});
//                m.save(function (err) {
//                    if (err) {
//                        console.log(err);
//                    }
//                    return res.send("inserted!!! ");
//                });


