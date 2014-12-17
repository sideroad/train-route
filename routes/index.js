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
var ignore = [
  'ChIJd3RBFRh9GGARZe607wjJjJM', //ベイサイド・ステーション駅
  'ChIJ7-y9RhR9GGARwgKYxSeXAtY', //東京ディズニーランド・ステーション駅
  'ChIJ41TW0BF9GGARxRxNrNtkbQ8', //リゾートゲートウェイ・ステーション駅
];
var get = function(url, callback){
  console.log(url);
  client.get(url, function(data){
    if(data) {
      callback(data);
    } else {
      superagent.get(url, function(data){
        client.set(url, data);
        client.expire(url, 86400000 * 30);
        callback(data);
      });
    }
  });
};
client.auth(redisURL.auth.split(":")[1]); 
client.flushdb();
var crypto = require('crypto');


router.get('/nearest/:lat/:lng', function(req, res){
  try {
    var lat = Number(req.params.lat),
        lng = Number(req.params.lng);
    async.waterfall([
      function(callback){
        var url = 'https://maps.googleapis.com/maps/api/place/search/json?'+
                  'location='+lat.toFixed(3)+','+lng.toFixed(3)+'&'+
                  'types=subway_station|train_station&'+
                  'sensor=true&'+
                  'rankby=distance&'+
                  'language=ja&'+
                  'key='+process.env.GOOGLE_API_KEY;

        get(url, function(placeJa){
          callback(null, _.find(placeJa.body.results || [], function(result){
            return !/(（株）|／)/.test(result.name) && ignore.indexOf(result.place_id) === -1;
          }));
        });
      },
      function(place, callback){
        var url = 'https://maps.googleapis.com/maps/api/directions/json?'+
                  'origin='+lat+','+lng+'&'+
                  'destination='+place.geometry.location.lat.toFixed(4)+','+place.geometry.location.lng.toFixed(4)+'&'+
                  'sensor=false&'+
                  'mode=walking&'+
                  'key='+process.env.GOOGLE_API_KEY;

        get(url, function(directions){
          var duration = directions.body.routes[0].legs.reduce(function(sum, leg){
            return sum + leg.duration.value;
          },0);
          callback(null, {
            name: place.name.split(/\s+/).pop(),
            duration: duration
          });
        });          
      }
    ], function(err, json){
        res.json(json);
        res.end();
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
              'ws=1',
        parse = function(url, callback){
                  console.log(url);
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
                              routes = [{},{},{}],
                              nextUrl;

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

                            var md5 = crypto.createHash('md5');
                            md5.update(JSON.stringify(routes),'utf8');
                            routes[index].id = md5.digest('hex');
                          });

                          nextUrl = $('.navSearchAround li.next a').attr('href');

                          client.set( url, JSON.stringify(routes) );
                          client.expire( url, 86400000);
                          callback(null, routes, nextUrl);
                        }
                      );
                    }
                  });
                };


    async.waterfall([
      function(callback){
        parse(url, function(routes, nextUrl){
          callback(null, routes, nextUrl);
        });
      },
      function(routes, url, callback){
        parse(url, function(_routes, nextUrl){
          callback(null, routes.concat(_routes), nextUrl);
        });
      },
      function(routes, url, callback){
        parse(url, function(_routes, nextUrl){
          callback(null, routes.concat(_routes), nextUrl);
        });
      },
    ], function(routes, nextUrl){
      res.set({
        'Access-Control-Allow-Origin':'*',
        'Access-Control-Allow-Methods':'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers':'*'
      });

      res.json({
        routes: routes
      });
      res.end();
    });


  } catch(err){
    console.log(err);
  }

});

module.exports = router;
