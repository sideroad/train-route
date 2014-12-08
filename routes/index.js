var express = require('express');
var router = express.Router();
var jsdom = require("jsdom");
var redis = require('redis');
var url = require('url');
var redisURL = url.parse(process.env.REDISCLOUD_URL);
var client = redis.createClient(redisURL.port, redisURL.hostname, {no_ready_check: true});
var superagent = require('superagent');
var async = require('async');
var _ = require('lodash');
client.auth(redisURL.auth.split(":")[1]); 
client.flushdb();

router.get('/nearest/:lat/:lng', function(req, res){
  try {
    async.waterfall([
      function(callback){
        var url = 'https://maps.googleapis.com/maps/api/place/search/json?'+
                  'location='+req.params.lat+','+req.params.lng+'&'+
                  'types=subway_station|train_station&'+
                  'sensor=true&'+
                  'rankby=distance&'+
                  'language=en&'+
                  'key='+process.env.GOOGLE_API_KEY;
        console.log(url);

        superagent.get(url, function(placeEn){
          callback(null, _.find(placeEn.body.results || [], function(result){
            return /^[a-zA-Z0-9 ]+$/.test(result.name);
          }));
        });
      },
      function(placeEn, callback){
        var url = 'https://maps.googleapis.com/maps/api/place/search/json?'+
                  'location='+placeEn.geometry.location.lat+','+placeEn.geometry.location.lng+'&'+
                  'types=subway_station|train_station&'+
                  'sensor=true&'+
                  'rankby=distance&'+
                  'language=ja&'+
                  'key='+process.env.GOOGLE_API_KEY;
        console.log(url);

        superagent.get(url, function(placeJa){
          callback(null, placeEn, placeJa.body.results[0] || {});
        });
      },
      function(placeEn, placeJa, callback){
        var url = 'https://maps.googleapis.com/maps/api/directions/json?'+
                  'origin='+req.params.lat+','+req.params.lng+'&'+
                  'destination='+placeEn.geometry.location.lat+','+placeEn.geometry.location.lng+'&'+
                  'sensor=false&'+
                  'mode=walking&'+
                  'key='+process.env.GOOGLE_API_KEY;

        console.log(url);
        superagent.get(url, function(directions){
          var duration = directions.body.routes[0].legs.reduce(function(sum, leg){
            return sum + leg.duration.value;
          },0);
          callback(null, {
            name: placeJa.name.split(/\s+/).pop(),
            nameEn: placeEn.name,
            duration: duration
          });
        });          
      }
    ], function(err, json){
        res.json(json);
    });
  } catch (err){
    console.log(err);
  }



});
router.get('/route/:from/:to/:date/:time/:sort/:type/', function(req, res) {  
  try {
    var url = 'http://transit.loco.yahoo.co.jp/search/result?'+
              'from='+req.params.from+'&'+
              'to='+req.params.to+'&'+
              'ym='+req.params.date.match(/^(\d\d\d\d\d\d)\d\d$/)[1]+'&'+
              'd=' +req.params.date.match(/^\d\d\d\d\d\d(\d\d)$/)[1]+'&'+
              'hh='+req.params.time.match(/^(\d\d)\d\d$/)[1]+'&'+
              'm1='+req.params.time.match(/^\d\d(\d)\d$/)[1]+'&'+
              'm2='+req.params.time.match(/^\d\d\d(\d)$/)[1]+'&'+
              'type='+req.params.type+'&'+ // 1: Departure time 2: Last train
              'ticket=ic&'+
              's='+req.params.sort+'&'+ // 0: First, 1: Price, 2: Ride count 
              'expkind=1&'+
              'ws=1';

    console.log(url);

    res.set({
      'Access-Control-Allow-Origin':'*',
      'Access-Control-Allow-Methods':'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers':'*'
    });

    client.get(url, function (err, routes) {
      if(routes) {
        res.json({
          routes: JSON.parse(routes)
        });
      } else {
        jsdom.env(
          url,
          ['http://code.jquery.com/jquery.js'],
          function (errors, window) {
            var $ = window.$,
                routes = [{},{},{}];

            $('#route01, #route02, #route03').each(function(index){
              var $route = $(this);

              $route.find('li.time').each(function(){
                var str = $(this).text(),
                    matched = str.match(/^(\d\d\:\d\d)発→(\d\d\:\d\d)着(\d+時間)?(\d+分)（乗車(\d+時間)?(\d+)分）$/);

                routes[index].departure = matched[1];
                routes[index].arrival = matched[2];
                routes[index].min = ( ( Number( (matched[3]||'').replace(/時間/,'') ) * 60 )+
                                   ( Number( (matched[4]||'').replace(/分/,'') )) );
              });

              routes[index].stations = $route.find('.station').map(function(stationIndex){
                var $station = $(this),
                    $times = $station.find('ul.time li'),
                    hasDeparture = $times.length === 1 && stationIndex !== 0 ? false : true,
                    hasArrival   = stationIndex === 0 ? false : true;

                return {
                  station:   $station.find('dt').text(),
                  departure: hasDeparture ? $times.filter(':last-child').text().replace(/発|着/,'') : '',
                  arrival:   hasArrival ?   $times.filter(':first-child').text().replace(/発|着/,'') : ''
                };
              }).get();

              routes[index].access = $route.find('.access').map(function(accessIndex){
                var $access = $(this),
                    approach = $access.find('.transport div').text();

                return {
                  approach: approach.match(/\[([^\]]+)\]/)[1],
                  line:   /\[train\]/.test(approach) ? approach.replace(/(\n|\[train\])/g, '') : '',
                  steps:  Number($access.find('.btnStopNum').text().replace(/駅/g, ''))||1
                };
              }).get();
            });

            client.set( url, JSON.stringify(routes) );
            res.json({
              routes: routes
            });
          }
        );
      }
    });
  } catch(err){
    console.log(err);
  }

});

module.exports = router;
