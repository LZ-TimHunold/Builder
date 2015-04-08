// ====================================
// Convert Time to HH:MM:SS

import {lg} from './quick-log';

String.prototype.toHHMMSS = function () {
	let sec_num = parseInt(this, 10); // don't forget the second param
	let hours = Math.floor(sec_num / 3600);
	let minutes = Math.floor((sec_num - (hours * 3600)) / 60);
	let seconds = sec_num - (hours * 3600) - (minutes * 60);

	if (hours < 10) {
		hours = '0'+hours;
	}
	if (minutes < 10) {
		minutes = '0'+minutes;
	}
	if (seconds < 10) {
		seconds = '0'+seconds;
	}
	let time = '';
	if (hours > 0) {
		time += hours+':';
	}
	time += minutes+':'+seconds;
	return time;
}

													lg(`snippet-convert_time_to_HHMMSS {blue{loaded}}`);
