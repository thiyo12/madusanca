export const TUTOR_REPORT_RUBRIC = [
  {
    key: "observation",
    title: "Observation",
    items: [
      { key: "observation_360_check", label: "360 Check" },
      { key: "observation_shoulder_check", label: "Shoulder Check" },
      { key: "observation_mirrors_surroundings", label: "Mirrors / Surroundings" },
    ],
  },
  {
    key: "speed",
    title: "Speed",
    items: [
      { key: "speed_special_zone", label: "Special Zone" },
      { key: "speed_residential", label: "Residential" },
      { key: "speed_city_road", label: "City Road" },
    ],
  },
  {
    key: "parking",
    title: "Parking",
    items: [
      { key: "parking_reverse_stall", label: "Reverse Stall" },
      { key: "parking_front_in_stall", label: "Front-in Stall" },
      { key: "parking_pull_over", label: "Pull Over" },
      { key: "parking_parallel", label: "Parallel" },
    ],
  },
  {
    key: "intersection",
    title: "Intersection",
    items: [
      { key: "intersection_two_way_stops", label: "2-Way Stops" },
      { key: "intersection_four_way_stops", label: "4-Way / All-Way Stops" },
      { key: "intersection_traffic_lights", label: "Traffic Lights" },
      { key: "intersection_roundabouts", label: "Traffic Circle / Roundabout" },
    ],
  },
  {
    key: "vehicle_control",
    title: "Vehicle Control",
    items: [
      { key: "vehicle_pre_trip", label: "Pre-Trip Inspection" },
      { key: "vehicle_steering", label: "Steering" },
      { key: "vehicle_braking_acceleration", label: "Braking and Acceleration" },
      { key: "vehicle_turning_speed", label: "Appropriate Turning Speed" },
    ],
  },
  {
    key: "traffic_rules",
    title: "Traffic Rules",
    items: [
      { key: "traffic_signs", label: "Signs" },
      { key: "traffic_road_markings", label: "Road Markings" },
      { key: "traffic_emergency_vehicles", label: "Emergency Vehicles" },
      { key: "traffic_hov_bus_lanes", label: "HOV / Bus Lanes" },
    ],
  },
  {
    key: "multi_lane_driving",
    title: "Multi-Lane Driving",
    items: [
      { key: "multi_lane_change", label: "Lane Change" },
      { key: "multi_merging", label: "Merging" },
      { key: "multi_highway", label: "Highway Driving" },
    ],
  },
  {
    key: "other",
    title: "Other",
    items: [
      { key: "other_pull_away", label: "Pull Away" },
      { key: "other_reversing_back", label: "Reversing Back" },
      { key: "other_narrow_streets", label: "Sharing Narrow Streets" },
      { key: "other_refuelling", label: "Vehicle Refuelling" },
    ],
  },
  {
    key: "appropriate_pedal",
    title: "Choosing the Appropriate Pedal",
    items: [
      { key: "pedal_hazards", label: "Possible Hazard" },
      { key: "pedal_hills", label: "Downhill / Uphill" },
      { key: "pedal_turns", label: "Turns" },
    ],
  },
] as const;

export type TutorReportSection = (typeof TUTOR_REPORT_RUBRIC)[number];
export type TutorReportSectionKey = TutorReportSection["key"];
type ItemsInSection<T> = T extends { readonly items: readonly (infer Item)[] } ? Item : never;
type AllTutorReportItems = ItemsInSection<TutorReportSection>;
export type TutorReportItemKey = AllTutorReportItems extends { readonly key: infer Key } ? Key : never;
export type TutorRubricScores = Partial<Record<TutorReportItemKey, number>>;
export type TutorSectionComments = Partial<Record<TutorReportSectionKey, string>>;

export const TUTOR_REPORT_ITEMS: Array<{ key: TutorReportItemKey; label: string }> =
  TUTOR_REPORT_RUBRIC.flatMap((section) => section.items.map((item) => ({ key: item.key, label: item.label })));
