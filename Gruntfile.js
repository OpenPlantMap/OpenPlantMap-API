/* globals module*/
module.exports = function (grunt) {
    'use strict';
    grunt.initConfig({
        path: {
            src: [
                'app.js'
            ],
            test: ['test/unit/test.js'],
            lint: [
                'Gruntfile.js',
                'test/lib/databaseObjects.js',
                '<%=path.src%>',
                '<%=path.test%>'
            ]
        },
        jshint: {
            files: {
                src: '<%=path.lint%>',
                options: {
                    jshintrc: true
                }
            }
        },
        mochaTest: {
            test: {
                src: '<%=path.test%>'
            }
        },
        watch: {
            files: '<%=path.lint%>',
            tasks: ['jshint', 'mochaTest:test']
        }



    });
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-contrib-watch');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-notify');
    grunt.registerTask('default', 'mochaTest:test');
};
