// ====================================
// Video
// The video object and video controls are referenced against each other by the video objects id and the video controls data-video attribute.
// This allows the code below to accommodate any number of videos on a page.

import $ from 'jquery';
import _ from 'lodash';
import {lg, lgObj} from './quick-log';
import './snippet-convert_time_to_HHMMSS';

let $video = $('video'),
	$video_controls = $('.video-controls'),
	$video_big_button = $('.video-big-button'),
	$play =  $('.video-controls').find('.play'),
	$seek =  $('.video-controls').find('.seek'),
	$mute =  $('.video-controls').find('.mute'),
	$volume =  $('.video-controls').find('.volume'),
	$fullscreen =  $('.video-controls').find('.fullscreen');

	let seek_drag_state = 0,							// 0: not dragging, 1: dragging. Check if cursor is dragging seek slider or not
		volume_drag_state = 0;							// 0: not dragging, 1: dragging. Check if cursor is dragging volume slider or not

if ($video.length) {
	
	// ====================================
	// Get referenced video from data-video attribute
	function getTargetVideoVanilla($x) {
		return document.getElementById($x.parent().attr('data-video'));
	}
	function getTargetVideoJQuery($x) {
		return $(`#${$x.parent().attr('data-video')}`);
	}

	// ====================================
	// Get referenced controls from video id
	function getTargetControls(obj, control) {
		let x = $(obj).attr('id');
		return $(`*[data-video='${x}']`).find(`.${control}`);
	}

	// ====================================
	// Get referenced big button from data-video attribute
	function getTargetButton($this) {
		let x = $this.parent().attr('data-video');
		return $(`*[data-video-button='${x}']`);
	}

	// ====================================
	// Play / Pause
	$play.on('click', function(){
		let $v = getTargetVideoVanilla($(this));		// Set target video
	
		if ($v.paused == true) {						// Set play/pause state
			$(this).removeClass('paused');				// Change play button to pause icon
			$v.play();									// Play video
			getTargetVideoJQuery($(this)).attr('data-video_state', 1);	// Set target video's video state
			getTargetButton($(this)).addClass('inactive');	// Hide big play button
														lg(`play video {orange{${$(this).parent().attr('data-video')}}}`);
		} else {
			$(this).addClass('paused');					// Change play button to play icon
			$v.pause();									// Pause video
			getTargetVideoJQuery($(this)).attr('data-video_state', 0);	// Set target video's video state
			getTargetButton($(this)).removeClass('inactive');	// Show big play button
														lg(`pause video {orange{${$(this).parent().attr('data-video')}}}`);
		}
	});

	// ====================================
	// Seek
	$seek
	.on('mousedown', function(){
		let $v = getTargetVideoVanilla($(this));
		$v.pause();										// Pause video while scrubbing slider
		seek_drag_state = 1;
	})
	.on('mouseup', function(){
		let $v = getTargetVideoVanilla($(this));		// Set target div
		if (parseInt(getTargetVideoJQuery($(this)).attr('data-video_state')) === 1) {
			$v.play();									// Play video if it was playing before
		}
		seek($(this), getTargetVideoVanilla($(this)));
		seek_drag_state = 0;
	})
	.on('mousemove', function(){
		seek($(this), getTargetVideoVanilla($(this)));
	});

	// ====================================
	// Seek Function
	function seek($this, $v){
		if(seek_drag_state === 1){
			// Update video
			let time = $v.duration * ($this.val() / 100);	// Calcuate time
			$v.currentTime = time;						// Set time
		
			// Update customer progress bar
			let $x = $this.parent().find('.seek-bar').find('.seek-progress'); // Set target div
			$x.css({'width': `${$this.val()}%`});		// Update width of progress bar div	
		}
	}

	// ====================================
	// Video Events
	$video
	.on('timeupdate', function(){
		// Only make updates if seek control is not being dragged
		if(seek_drag_state === 0){
			// Update seek slider
			let value = (100 / this.duration) * this.currentTime;	// Calculate slider value
			getTargetControls(this, 'seek').val(value);	// Update seek slider
		
			// Update customer progress bar
			let $x = getTargetControls(this, 'seek-bar').find('.seek-progress');
			$x.css({'width': `${getTargetControls(this, 'seek').val()}%`});
		
			getTargetControls(this, 'progress-text').html((this.currentTime).toString().toHHMMSS() + ' / ' + (this.duration).toString().toHHMMSS());
		}
	})
	.on('ended', function(){
		$(this).attr('data-video_state', 0);			// When video ends, set video variable state to paused
		getTargetControls(this, 'play').addClass('paused'); // Set play/pause button to paused
		
		// Check if video exists within a modal. If so, close the modal.
		//let $x = $(this).parent().parent();
		//if ($x.hasClass('modal-inner-margin')) {
		//	$x.trigger('click');
		//}
														lg(`video end {orange{${$(this).attr('id')}}}`);

	})
	.on('loadedmetadata', function(){
		getTargetControls(this, 'progress-text').html((this.currentTime).toString().toHHMMSS() + ' / ' + (this.duration).toString().toHHMMSS());
	});

	// ====================================
	// Big Play Button
	$video_big_button
	.on('mouseenter', function(){
		$(this).parent().find('.video-controls').addClass('active');
	})
	.on('mouseleave', function(){
		$(this).parent().find('.video-controls').removeClass('active');
	})
	.on('click', function(){
		$(this).parent().find('.video-controls').find('.play').trigger('click');	// Just trigger standard play button click because functionality is exactly the same
	});

	// ====================================
	// Video Controls Container
	$video_controls
	.on('mouseenter', function(){
		$video_controls.addClass('active');
	})
	.on('mouseleave', function(){
		$video_controls.removeClass('active');
	});

	// ====================================
	// Mute / Unmute
	$mute.on('click', function(){
		let $v = getTargetVideoVanilla($(this));		// Set target video
		let $x = $(this).parent().find('.volume-container');	// Set target volume controls

		if ($v.muted == false) {						// Set mute/unmute state
			$(this).addClass('muted');					// Change mute button icon to muted
			$v.muted = true;							// Mute video
			$x.addClass('inactive');					// Obscure volume controls while muted
			$x.find('.volume').attr('disabled', true);	// Disable volume controls while muted
														lg(`mute video {orange{${$(this).parent().attr('data-video')}}}`);
		} else {
			$(this).removeClass('muted');				// Change mute button icon to unmuted
			$v.muted = false;							// Unmute video
			$x.removeClass('inactive');					// Visually re-enable default volume control 
			$x.find('.volume').attr('disabled', false);	// Re-enable volume controls
														lg(`unmute video {orange{${$(this).parent().attr('data-video')}}}`);
		}
	});

	// ====================================
	// Fullscreen
	$fullscreen.on('click', function(){
		let $v = getTargetVideoVanilla($(this));		// Set target video

		if ($v.requestFullscreen) {
			$v.requestFullscreen();						// Set Fullscreen
		} else if ($v.mozRequestFullScreen) {
			$v.mozRequestFullScreen();					// for Firefox
		} else if ($v.webkitRequestFullscreen) {
			$v.webkitRequestFullscreen();				// for Chrome and Safari
		}
	});

	// ====================================
	// Volume
	$volume
	.on('mousedown', function(){
		volume_drag_state = 1;
	})
	.on('mouseup', function(){
		setVolume($(this));
		volume_drag_state = 0;
	})
	.on('mousemove', function(){
		setVolume($(this));
	});

	// ====================================
	// Volume Function
	function setVolume($this){
		if(volume_drag_state === 1){
			let $v = getTargetVideoVanilla($this.parent());	// Set target video
			let volume = $this.val() / 100;				// Calculate video volume
			$v.volume = volume;							// Set volume
		
			// Update customer progress bar
			let $x = $this.parent().find('.volume-bar').find('.volume-level');	// Set target div
			$x.css({'width': `${$this.val()}%`});		// Update width of volume level div
		}
	}

	// ========================================================================
	// Video as Background

	let $video_background = $('.video-background');

	$video_background.each(function(){
		resize_background_video($(this));
	});

	// Resize and Reposition Background Video
	function resize_background_video($this){
		let vid_height = $this.height(),				// Video height
			vid_width = $this.width(),					// Video width
			parent_height = $this.parent().height(),	// Video parent height
			parent_width = $this.parent().width();		// Video parent width
	
		let width_ratio = vid_width / parent_width,		// Calculate width and height ratios
			height_ratio = vid_height / parent_height;
	
		// Compare ratios of width and height to parent to determine whether video needs to be resized/positioned vertically or horizontally
		if (width_ratio > height_ratio) {
			$this.parent().css({'width': `${1 / height_ratio * 100}%`});
			$this.css({'width': '100%'});
			let vid_new_width = $this.width();
			$this.parent().css({'left': (parent_width / 2) - (vid_new_width / 2), 'top': 0});	// Set new video position to vertically center in parent
		} else {
			$this.parent().css({'width': '100%'});
			$this.css({'width': '100%'});
			let vid_new_height = $this.height();
			$this.parent().css({'top': (parent_height / 2) - (vid_new_height / 2), 'left': 0});	// Set new video position to vertically center in parent
		}
	}

	// Resize and reposition all - For window resize
	function resize_all_background_videos(){
		$video_background.each(function(){
			$(this).css({'width': '100%'});
			$(this).parent().css({'width': '100%'});
			resize_background_video($(this));
		});
	}

	// Resize and reposition all debounce
	let debounce_resize_all_background_videos = _.debounce(resize_all_background_videos, 100);

	// Resize and position background video if window is resized
	$(window).on('resize', function() {
		debounce_resize_all_background_videos();
	});
}

													lg(`video {blue{loaded}}`);
