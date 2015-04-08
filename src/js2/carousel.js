// ====================================
// Carousel
// Using http://kenwheeler.github.io/slick/

import $ from 'jquery';
import slick from 'slick-carousel';
import {lg} from './quick-log';

let $slider = $('.slider');							// Sliders

if ($slider.length) {
	$slider
	.map(function(v,k){
		let dots = $(this).attr('data-slider-bullets') === 'no' ? false : true,
			arrows = $(this).attr('data-slider-arrows') === 'no' ? false : true,
			fade = $(this).attr('data-slider-fade') === 'no' ? false : true,
			slidesToShow = parseInt($(this).attr('data-slider-slidesToShow')),
			slidesToScroll = parseInt($(this).attr('data-slider-slidesToScroll')),
			autoplay = $(this).attr('data-slider-autoplay') === 'no' ? false : true,
			autoplaySpeed = parseInt($(this).attr('data-slider-autoplaySpeed')),
			pauseOnHover = $(this).attr('data-slider-pauseOnHover') === 'no' ? false : true;
	
		$(this).slick({
			dots: dots,
			infinite: true,
			speed: 500,
			slidesToShow: slidesToShow,
			slidesToScroll: slidesToScroll,
			arrows: arrows,
			fade: fade,
			autoplay: autoplay,
			autoplaySpeed: autoplaySpeed,
			pauseOnHover: pauseOnHover,
			responsive: [
				{
					breakpoint: 640,
					settings: {
						slidesToShow: 1					// At less than 640px, force only showing 1 slide at a time.
					}
				}
			]
		});
		adjust_slider_height();
	})

	// Clean up slider height
	// For an unknown reason, when slick.js pulls content into the carousel, it retains the "space" where the original content was of the height and width of that content.
	// This was fixed by specifying a height on the slider element (style="height"450px;), which is not ideal, but the only way I discovered that could fix this issue.
	// But setting a height on the slider created a new issue, that the height of content elements (such as class height450) is variable between mobile and desktop, and specifying a height directly on the elements causes it to be the same height on desktop and mobile.
	// So final solution is to check window resize and adjust the height with JavaScript.
	// None of this is ideal, of course, but after many many tests, this is the only solution I've found.
	function adjust_slider_height(){
		let height_adjustment = 0;
		$slider.find('section').map(function(v,k){
			height_adjustment = $(k).outerHeight() > height_adjustment ? $(k).outerHeight() : height_adjustment;
		});
														//lg(`height_adjustment: ${height_adjustment}`);
		$slider.css({'height': height_adjustment});
	}

	$(window).on('resize', function() {
		adjust_slider_height();
	});
}

													lg(`carousel {blue{loaded}}`);