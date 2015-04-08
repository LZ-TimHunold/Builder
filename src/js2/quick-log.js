// ====================================
// Quick and Dirty Debugging
//
// This is my quick way for printing things to the screen without having to open the inspector or 
// have the inspector take up screen real estate. It's basically a better unintrusive "alert" 
// meant for simple logging only.
//
// Text can be colored for easy scanning with the following colors:
//
// {red{ text }}
// {orange{ text }}
// {yellow{ text }}
// {green{ text }}
// {blue{ text }}
// {purple{ text }}
// {gray{ text }}

import $ from 'jquery';

let html_snippet = `<div id=lg style="
	background:rgba(0,0,0,.88);
	position:fixed;
	bottom:0;
	right:0;
	color:#ccc;
	padding:5px;
	font-family:Inconsolata, arial;
	font-size:.7em;
	z-index:9999;
	-webkit-font-smoothing:subpixel-antialiased;
	display:none;
	line-height:1.1em;
	border-top-left-radius: 5px;
	"><span style="color:#3bbb33;">> Hover over me to hide</span><br></div>`;

$('body').append(html_snippet);

$('#lg').on('mouseenter', function(){$(this).html('').css({'display': 'none'});});

function lg(x){
	let y = x
		//.replace(/^#/, '<span style="color:#7a7a7a;">#</span>')
		//.replace(/^\//g, '<span style="color:#7a7a7a;">/</span>')
		.replace(/\{blue\{/g, '<span style="color:#42bab7;">')
		.replace(/\{purple\{/g, '<span style="color:#d238ce;">')
		.replace(/\{orange\{/g, '<span style="color:#ff5f21;">')
		.replace(/\{gray\{/g, '<span style="color:#7a7a7a;">')
		.replace(/\{green\{/g, '<span style="color:#3bbb33;">')
		.replace(/\{red\{/g, '<span style="color:#dc0101;">')
		.replace(/\{yellow\{/g, '<span style="color:#e2e03c;">')
		.replace(/\}\}/g, '</span>')
		;
	$('#lg').css({'display': 'block'}).append(`<span style="color:#7a7a7a;"># </span>${y}<br>`);
}

function lgObj(o) {
	var out = '';
	for (var p in o) {
		out += p + ': ' + o[p] + '\n';
	}
	lg(out);
};

export {lg, lgObj}
													lg(`quick-log {blue{loaded}}`);
