// ====================================
// skrollr

import $ from 'jquery';
import {lg} from './quick-log';
import s from 'skrollr';

if ($('.scroll-motion').length) {
	lg(`skrollr start`);
	s.init();
} else {
	lg(`skrollr no start`);
}
													lg(`skrollr {blue{loaded}}`);