// ====================================
// Tooltip

import $ from 'jquery';
import _ from 'lodash';
import {lg, lgObj} from './quick-log';

let $tooltip = $('.tooltip'),						// The tooltips to open/hide
	$tooltip_link = $('.tooltip-link'),				// What gets hovered on to open the tooltip
	$active_tooltip,								// Active tooltip
	$active_link;									// Active link to display tooltip

if ($tooltip.length) {
	// Show tooltip debounce
	let debounce_show_tooltip = _.debounce(show_tooltip, 200);

	// Show tooltip
	function show_tooltip(){

		// Get desired position of tooltip relative to link (We'll adjust if desired position falls outside of viewport.)
		let tooltip_position = $active_link.attr('data-tooltip-position');
	
		// Display tooltip but set opacity to 0 so we can set up positioning first
		$active_tooltip.css({'display': 'block', 'opacity': 0}).removeClass('tooltip-full');
	
		// Tooltip attributes
		let tooltip = {
			height: $active_tooltip.outerHeight(),
			width: $active_tooltip.outerWidth()
		}
	
		// Link attributes
		let link = {
			width: $active_link.outerWidth(),
			height: $active_link.outerHeight(),
			x: $active_link.offset().left,
			y: $active_link.offset().top
		}

		// Window and viewport bounds from window scroll position
		let window_width = $(window).width();
		let scrollPos = {
			top: $(window).scrollTop(),
			bottom: $(window).scrollTop() + $(window).height()
		};
		
		// Additional vars for calculating position
		let pointer_size = 10,
			pointer_position_from_top_for_left_and_right = 32,
			additional_distance = window_width > 640 ? 5 : 0;	// Additional gap between link and tooltip

		// Tooltip x/y positions
		link.top = {
			x: (link.x + (link.width / 2))  -  (tooltip.width / 2),
			y: (link.y - pointer_size - additional_distance) - (tooltip.height)
		};
		link.bottom = {
			x: (link.x + (link.width / 2))  -  (tooltip.width / 2),
			y: link.y + link.height + pointer_size + additional_distance
		};
		link.left = {
			x: (link.x - pointer_size - additional_distance)  -  (tooltip.width),
			y: link.y + (link.height / 2) - pointer_position_from_top_for_left_and_right
		};
		link.right = {
			x: link.x + link.width + pointer_size + additional_distance,
			y: link.y + (link.height / 2) - pointer_position_from_top_for_left_and_right
		};

		// Variables to store whether tooltip position will be inbounds or not. Initially set to 1 (yes).
		let is_in = {
			top: 1,
			bottom: 1,
			left: 1,
			right: 1,
			target_pos: ''						// The desired target position of the tooltip after calculating which are inbounds or not.
		}
	
		// Get Corner Coordinates which we'll use to check whether potential tooltip are inbounds or not
		// Checking all potential positions first to see which are inbounds makes it easier to accommodate fallback positions from the desired position
		let corners = {
			pos_top: {
				corner1: {
					x: link.top.x,
					y: link.top.y - scrollPos.top
				}, 
				corner2: {
					x: link.top.x + tooltip.width,
					y: link.top.y + tooltip.height - scrollPos.top
				}
			},
			pos_bottom: {
				corner1: {
					x: link.bottom.x,
					y: link.bottom.y - scrollPos.top
				}, 
				corner2: {
					x: link.bottom.x + tooltip.width,
					y: link.bottom.y + tooltip.height - scrollPos.top
				}
			},
			pos_left: {
				corner1: {
					x: link.left.x,
					y: link.left.y - scrollPos.top
				}, 
				corner2: {
					x: link.left.x + tooltip.width,
					y: link.left.y + tooltip.height - scrollPos.top
				}
			},
			pos_right: {
				corner1: {
					x: link.right.x,
					y: link.right.y - scrollPos.top
				}, 
				corner2: {
					x: link.right.x + tooltip.width,
					y: link.right.y + tooltip.height - scrollPos.top
				}
			},
		}
	
		// If any corner of a potential tooltip position falls out of bounds, mark it as out of bounds
		if (corners.pos_top.corner1.x < 0 || corners.pos_top.corner1.y < 0 || corners.pos_top.corner2.x < 0 || corners.pos_top.corner2.y < 0 || corners.pos_top.corner1.x > window_width || corners.pos_top.corner1.y > scrollPos.bottom || corners.pos_top.corner2.x > window_width || corners.pos_top.corner2.y > scrollPos.bottom) {
			is_in.top = 0;
		}
		if (corners.pos_bottom.corner1.x < 0 || corners.pos_bottom.corner1.y < 0 || corners.pos_bottom.corner2.x < 0 || corners.pos_bottom.corner2.y < 0 || corners.pos_bottom.corner1.x > window_width || corners.pos_bottom.corner1.y > scrollPos.bottom || corners.pos_bottom.corner2.x > window_width || corners.pos_bottom.corner2.y > scrollPos.bottom) {
			is_in.bottom = 0;
		}
		if (corners.pos_left.corner1.x < 0 || corners.pos_left.corner1.y < 0 || corners.pos_left.corner2.x < 0 || corners.pos_left.corner2.y < 0 || corners.pos_left.corner1.x > window_width || corners.pos_left.corner1.y > scrollPos.bottom || corners.pos_left.corner2.x > window_width || corners.pos_left.corner2.y > scrollPos.bottom) {
			is_in.left = 0;
		}
		if (corners.pos_right.corner1.x < 0 || corners.pos_right.corner1.y < 0 || corners.pos_right.corner2.x < 0 || corners.pos_right.corner2.y < 0 || corners.pos_right.corner1.x > window_width || corners.pos_right.corner1.y > scrollPos.bottom || corners.pos_right.corner2.x > window_width || corners.pos_right.corner2.y > scrollPos.bottom) {
			is_in.right = 0;
		}
	
		// Set the actual tooltip position based on which potential positions fell within bounds.
		// If none are inbounds, set the target position to none and we will make an additional accommodation.
		if (tooltip_position === 'top') {
			is_in.target_pos = 	
						is_in.top === 1 ? 'top' : 
						is_in.right === 1 ? 'right' : 
						is_in.left === 1 ? 'left' : 
						is_in.bottom === 1 ? 'bottom' :
						'none';
		} else if (tooltip_position === 'bottom') {
			is_in.target_pos = 	
						is_in.bottom === 1 ? 'bottom' :
						is_in.right === 1 ? 'right' : 
						is_in.left === 1 ? 'left' : 
						is_in.top === 1 ? 'top' : 
						'none';
		} else if (tooltip_position === 'left') {
			is_in.target_pos = 	
						is_in.left === 1 ? 'left' : 
						is_in.right === 1 ? 'right' : 
						is_in.top === 1 ? 'top' : 
						is_in.bottom === 1 ? 'bottom' :
						'none';
		} else if (tooltip_position === 'right') {
			is_in.target_pos = 	
						is_in.right === 1 ? 'right' : 
						is_in.left === 1 ? 'left' : 
						is_in.top === 1 ? 'top' : 
						is_in.bottom === 1 ? 'bottom' :
						'none';
		}
	
		// If all tooltips are out of bounds, check whether top or bottom are most inbounds and display that one.
		// We're only using top and bottom, because the most common reason no potential positions would fall in bounds would be on mobile in portrait mode.
		// If we find that mobile landscapes are important, we can add additional accommodations.
		if (is_in.target_pos === 'none') {
			let how_far_out = {
				top: 0,
				bottom: 0
			}
		
			// Calculate how far out tooltip positioned on top would be
			how_far_out.top += corners.pos_top.corner1.x < 0 ? corners.pos_top.corner1.x : 0;
			how_far_out.top -= corners.pos_top.corner1.x > window_width ? corners.pos_top.corner1.x : 0;
			how_far_out.top += corners.pos_top.corner1.y < 0 ? corners.pos_top.corner1.y : 0;
			how_far_out.top -= corners.pos_top.corner1.y > scrollPos.bottom ? corners.pos_top.corner1.y : 0;
		
			how_far_out.top += corners.pos_top.corner2.x < 0 ? corners.pos_top.corner2.x : 0;
			how_far_out.top -= corners.pos_top.corner2.x > window_width ? corners.pos_top.corner2.x : 0;
			how_far_out.top += corners.pos_top.corner2.y < 0 ? corners.pos_top.corner2.y : 0;
			how_far_out.top -= corners.pos_top.corner2.y > scrollPos.bottom ? corners.pos_top.corner2.y : 0;
		
			// Calculate how far out tooltip positioned on bottom would be
			how_far_out.bottom += corners.pos_bottom.corner1.x < 0 ? corners.pos_bottom.corner1.x : 0;
			how_far_out.bottom -= corners.pos_bottom.corner1.x > window_width ? corners.pos_bottom.corner1.x : 0;
			how_far_out.bottom += corners.pos_bottom.corner1.y < 0 ? corners.pos_bottom.corner1.y : 0;
			how_far_out.bottom -= corners.pos_bottom.corner1.y > scrollPos.bottom ? corners.pos_bottom.corner1.y : 0;
		
			how_far_out.bottom += corners.pos_bottom.corner2.x < 0 ? corners.pos_bottom.corner2.x : 0;
			how_far_out.bottom -= corners.pos_bottom.corner2.x > window_width ? corners.pos_bottom.corner2.x : 0;
			how_far_out.bottom += corners.pos_bottom.corner2.y < 0 ? corners.pos_bottom.corner2.y : 0;
			how_far_out.bottom -= corners.pos_bottom.corner2.y > scrollPos.bottom ? corners.pos_bottom.corner2.y : 0;
		
			// Set attributes regardless if it ends up on top or bottom
			addTooltipClass('tooltip-full');
			$active_tooltip.css({'left': (window_width / 2) - ($active_tooltip.outerWidth() / 2)});
		
			// Recalculate link.top.y position
			link.top.y = (link.y - pointer_size - additional_distance) - ($active_tooltip.outerHeight());
		
			// Compare whether top or bottom is more inbounds and show that one
			if (how_far_out.top >= how_far_out.bottom) {
				$active_tooltip.css({'top': link.top.y});
			} else {
				$active_tooltip.css({'top': link.bottom.y});
			}
		} else {
		// Else position tooltip in following priority of if it is inbounds
			if (is_in.target_pos === 'top') {
				$active_tooltip.css({'left': link.top.x, 'top': link.top.y});
				addTooltipClass('tooltip-top');
			} else if (is_in.target_pos === 'right') {
				$active_tooltip.css({'left': link.right.x, 'top': link.right.y});
				addTooltipClass('tooltip-right');
			} else if (is_in.target_pos === 'left') {
				$active_tooltip.css({'left': link.left.x, 'top': link.left.y});
				addTooltipClass('tooltip-left');
			} else if (is_in.target_pos === 'bottom') {
				$active_tooltip.css({'left': link.bottom.x, 'top': link.bottom.y});
				addTooltipClass('tooltip-bottom');
			}
		}
			
		// Now show the tooltip
		$active_tooltip.css({'opacity': 1});
	}

	function addTooltipClass(x) {
		$active_tooltip
			.removeClass('tooltip-top tooltip-bottom tooltip-left tooltip-right tooltip-full')
			.addClass(x);
	}

	// Hide tooltip
	function hide_tooltip($x){
		$x.hide();
	}

	// Show tooltip on hover
	$tooltip_link
	.on('mouseenter', function(){
		$active_tooltip = $('.' + $(this).attr('data-tooltip'));
		$active_link = $(this);
		debounce_show_tooltip();
	})
	.on('mouseleave', function(){
		debounce_show_tooltip.cancel();
		hide_tooltip($(`.${$(this).attr('data-tooltip')}`));
	})
	// TOUCH: Toggle
	.on('touchend', function(){
		$active_tooltip = $('.' + $(this).attr('data-tooltip'));
		$active_link = $(this);
	
		if ($active_tooltip.css('display') === 'block') {
			hide_tooltip($active_tooltip)
		} else {
			$tooltip.hide();
			show_tooltip();
		}
	});

	// TOUCH: Close
	$tooltip
	.on('touchend', function(){
		$(this).hide();
	});
}
													lg(`tooltip {blue{loaded}}`);