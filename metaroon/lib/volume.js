'use strict';

function attach(proto, getCurrentInstance) {

	proto.registerVolumeControl = function() {
		var self = this;

		if (!self.roonVolumeControl || !self.outputId) return;

		try {
			var currentVolume = self.commandRouter.volumioretrievevolume();
			var vol = (currentVolume && currentVolume.vol !== undefined) ? currentVolume.vol : 50;

			self.volumeControlInstance = self.roonVolumeControl.new_device({
				state: {
					display_name: 'Volumio',
					volume_type: 'number',
					volume_min: 0,
					volume_max: 100,
					volume_value: vol,
					volume_step: 1,
					is_muted: (currentVolume && currentVolume.mute) || false
				},
				set_volume: function(req, mode, value) {
					var inst = getCurrentInstance() || self;
					try {
						var newVol = value;
						if (mode === 'relative') {
							var cur = inst.commandRouter.volumioretrievevolume();
							newVol = (cur && cur.vol !== undefined ? cur.vol : 50) + value;
						}
						newVol = Math.max(0, Math.min(100, newVol));
						inst.commandRouter.volumiosetvolume(newVol);
						if (inst.volumeControlInstance) {
							inst.volumeControlInstance.update_state({ volume_value: newVol });
						}
					} catch (e) {
						inst.logger.warn('metaroon: Error setting volume: ' + e.message);
					}
					req.send_complete('Success');
				},
				set_mute: function(req, action) {
					var inst = getCurrentInstance() || self;
					try {
						if (action === 'on') {
							inst.commandRouter.volumiosetvolume('mute');
							if (inst.volumeControlInstance) {
								inst.volumeControlInstance.update_state({ is_muted: true });
							}
						} else {
							inst.commandRouter.volumiosetvolume('unmute');
							if (inst.volumeControlInstance) {
								inst.volumeControlInstance.update_state({ is_muted: false });
							}
						}
					} catch (e) {
						inst.logger.warn('metaroon: Error setting mute: ' + e.message);
					}
					req.send_complete('Success');
				}
			});

			self.logger.info('metaroon: Volume control registered with Roon');
		} catch (e) {
			self.logger.warn('metaroon: Error registering volume control: ' + e.message);
		}
	};

	proto.unregisterVolumeControl = function() {
		if (this.volumeControlInstance) {
			try {
				this.volumeControlInstance.destroy();
			} catch (e) { /* ignore */ }
			this.volumeControlInstance = null;
		}
	};
}

module.exports = { attach };