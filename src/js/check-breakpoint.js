// ====================================
// Check Breakpoint

import $ from 'jquery';
import {lg} from './quick-log';

function isDesktop(){
	if ($(window).width() > 640) {
		return true;
	} else {
		return false;
	}
}
function isMobile(){
	if ($(window).width() <= 640) {
		return true;
	} else {
		return false;
	}
}
function isTablet(){
	if ($(window).width() <= 980) {
		return true;
	} else {
		return false;
	}
}

export {isDesktop, isTablet, isMobile}

													lg(`check breakpoint {blue{loaded}}`);
