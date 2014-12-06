var express = require('express');
var router = express.Router();
var jsdom = require("jsdom");
var redis = require('redis');
var url = require('url');
var redisURL = url.parse(process.env.REDISCLOUD_URL);
var client = redis.createClient(redisURL.port, redisURL.hostname, {no_ready_check: true});
client.auth(redisURL.auth.split(":")[1]);

/* GET home page. */
router.get('/route/:from/:to/:date/:time/:type/', function(req, res) {
  var url = 'http://transit.loco.yahoo.co.jp/search/result?'+
            'from='+req.params.from+'&'+
            'to='+req.params.to+'&'+
            'ym='+req.params.date.match(/^(\d\d\d\d\d\d)\d\d$/)[1]+'&'+
            'd=' +req.params.date.match(/^\d\d\d\d\d\d(\d\d)$/)[1]+'&'+
            'hh='+req.params.time.match(/^(\d\d)\d\d$/)[1]+'&'+
            'm1='+req.params.time.match(/^\d\d\d(\d)$/)[1]+'&'+
            'm2='+req.params.time.match(/^\d\d(\d)\d$/)[1]+'&'+
            'type=1&'+
            'ticket=ic&'+
            's='+req.params.type+'&'+ // 0: First, 1: Price, 2: Ride count 
            'expkind=1&'+
            'ws=1';


client.get(url, function (err, routes) {
  if(routes) {
    res.send({
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
                matched = str.match(/^(\d\d\:\d\d)発→(\d\d\:\d\d)着(\d+時間)?(\d+分)（乗車(\d+)分）$/);

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
            var $access = $(this);

            return {
              line:   $access.find('.transport div').text().replace(/(\n|\[train\])/g, ''),
              steps:  $access.find('.btnStopNum').text().replace(/駅/g, '')
            };
          }).get();
        });

        client.set( url, JSON.stringify(routes) );
        res.send({
          routes: routes
        });
      }
    );
  }
});


});

module.exports = router;
