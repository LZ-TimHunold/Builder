// ====================================
// Navigation Menus

import $ from 'jquery';
import _ from 'lodash';
import {lg} from './quick-log';

// ====================================
// Desktop Navigation

let $nav_menu = $('.nav_menu'),						// The hidden nav menus
	$nav_link = $('.nav-level-1 li');				// The nav buttons

let menu_state = 0,									// 0: hidden, 1: visible. This will let us know if any menu is visible.
	active_menu = '';								// The currently active menu

if ($nav_menu.length) {

	// Debounce functions to tweak interaction timing
	let debounce_show_menu = _.debounce(show_menu, 300),
		debounce_hide_menu = _.debounce(hide_menu, 150);

	// Show menu function
	function show_menu(){
		$nav_menu.hide();
		$(`.${active_menu}`).show();
		menu_state = 1;
														lg(`menu {blue{shown}}: {purple{${active_menu}}}`);
	}

	// Hide menu function
	function hide_menu(){
		if (menu_state === 1) {
			$nav_menu.hide();
			menu_state = 0;
														lg(`all menus {blue{hidden}}`);
		}
	}

	// Nav menu buttons
	$nav_link
	.on('mouseenter', function(){
		debounce_hide_menu.cancel();
		active_menu = $(this).attr('data-menu');
		if (menu_state === 0) {
			debounce_show_menu();
		} else if (menu_state === 1) {
			show_menu();
		}
	})
	.on('mouseleave', function(){
		debounce_show_menu.cancel();
		debounce_hide_menu();
	})

	// Nav menus
	$nav_menu
	.on('mouseenter', function(){
		debounce_hide_menu.cancel();
	})
	.on('mouseleave', function(){
		debounce_show_menu.cancel();
		debounce_hide_menu();
	})

	// ====================================
	// Mobile Navigation

	let $nav_menu_mobile = $('.nav_menu_mobile'),		// The hidden mobile nav menu
		$nav_mobile_link = $('.nav-mobile_menu');		// The mobile nav button

	$nav_mobile_link.on('click', function(e){
		e.preventDefault();
		$nav_menu_mobile.toggle();
		$(this).toggleClass('active');
	})
}

													lg(`nav {blue{loaded}}`);
