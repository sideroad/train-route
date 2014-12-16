

$(function(){
  alert(document.location.href);
  var data = {
    stations: ['品川シーサイド', '船橋法典', '舞浜'],
    roundtrip: ['品川シーサイド', '船橋法典']
  };

  var $stations = $("#stations");
  var $departure = $("#departure");
  var $arrival = $("#arrival");

  var addStation = function(station){
    $stations.append('<li data-icon="delete"><a href="#">'+station+'</a></li>');
    $departure.append('<option '+(data.roundtrip[0]==station ? 'selected': '')+' >'+station+'</option>');
    $arrival.append('<option '+(data.roundtrip[1]==station ? 'selected': '')+' >'+station+'</option>');
  };

  data.stations.forEach(function(station){
    addStation(station);
  });

  var $add = $("#station-add");
  var $station = $("#station");
  $add.click(function(){
    var station = $station.val();
    if(!station) {
      return;
    }
    data.stations.push(station);
    addStation(station);
    $stations.listview('refresh');
  });

  $stations.delegate('.ui-icon-delete', 'click', function(){
    var $this = $(this);
    $this.parents('li').remove();
    var index = data.stations.indexOf($this.text());
    if (index > -1) {
      data.stations.splice(index, 1);
    }
    $stations.listview('refresh');    
  });

  $departure.change(function(){
    data.roundtrip[0] = $(this).val();
  });
  $arrival.change(function(){
    data.roundtrip[1] = $(this).val();
  });



  $('#submit').click(function(){
    console.log(data);
    document.location = 'pebblejs://close#' + encodeURIComponent(JSON.stringify(data));
  });

});
