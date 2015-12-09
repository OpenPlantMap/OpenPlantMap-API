OpenPlantMap-API
================
This is the back-end for [OpenPlantMap](http://opensensemap.org).

The OpenPlantMap-API is based on the [OpenSenseMap-API] (https://github.com/sensebox/OpenSenseMap-API) and adapted for OpenPlantMap.

OpenPlantMap is created within the course "SenseBox for People-Centered Urban Planning" at the Institute for Geoinformatics (WWU Münster).

### Installation instructions
The installation steps are the same like the of [OpenSenseMap-API] (https://github.com/sensebox/OpenSenseMap-API).
The following instructions are copied from the README file of this project.
#### Technologies

* [node.js]
* [MongoDB]

#### Install dependencies (Ubuntu)

It is assumed that you have installed node.js (developed using 0.10.26)

Install MongoDB according to [the manual](http://docs.mongodb.org/manual/installation/) and create the database "OSeM-api".

The database schema will be created automatically upon data insertion and looks like this:
```
Database "OSeM-api"
  - Collections
    - boxes
    - measurements
    - sensors
```

#### Run for Development & Production

Open the configuration file ```config/index.js``` and change settings accordingly.

|Variable name             | Explanation|
|--------------------------|---------------|
|```exports.targetFolder```|The folder where a generated Arduino sketch for each box will be saved upon registration|
|```exports.imageFolder``` |The folder where banner images for boxes are stored, should be in your htdocs (make sure read and write permissions are correct)|
|```exports.dbuser```      |MongoDB database user, leave empty if not configured|
|```exports.dbuserpass```  |MongoDB database password, leave empty if not configured|

After that, run the following command to install dependencies:

```npm install```

Then start the API process, press CTRL+C to stop:

```
node app.js
```

**or with Docker**
- install docker and docker-compose
- run `docker-compose up`

#### Create the JSDoc pages

To create the documentation you need [apidocjs](http://apidocjs.com/) and run:
```
apidoc -e node_modules/
```

To push a new Version to gh-pages run:
```
git subtree push --prefix doc/ origin gh-pages
```

#### License

[MIT](license.md) - Matthias Pfeil 2015

[node.js]:http://nodejs.org/
[MongoDB]:http://www.mongodb.com/
