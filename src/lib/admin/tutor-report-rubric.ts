export const TUTOR_REPORT_RUBRIC = [
  {
    key: "observation",
    title: "Observation",
    items: [
      { key: "observation_360_check", label: "360 Check", description: "Checks all around before moving or changing direction." },
      { key: "observation_shoulder_check", label: "Shoulder Check", description: "Looks over the shoulder to check blind spots." },
      { key: "observation_mirrors_surroundings", label: "Mirrors / Surroundings", description: "Uses mirrors and scans the surroundings regularly." },
    ],
  },
  {
    key: "speed",
    title: "Speed",
    items: [
      { key: "speed_special_zone", label: "Special Zone", description: "Adjusts speed appropriately in school, playground, and other special zones." },
      { key: "speed_residential", label: "Residential", description: "Chooses a safe speed for residential streets and conditions." },
      { key: "speed_city_road", label: "City Road", description: "Maintains a safe, appropriate speed on city roads." },
    ],
  },
  {
    key: "parking",
    title: "Parking",
    items: [
      { key: "parking_reverse_stall", label: "Reverse Stall", description: "Reverses into a stall with safe observation and control." },
      { key: "parking_front_in_stall", label: "Front-in Stall", description: "Enters a stall smoothly and positions the vehicle safely." },
      { key: "parking_pull_over", label: "Pull Over", description: "Selects a safe place and pulls over accurately." },
      { key: "parking_parallel", label: "Parallel", description: "Parks parallel to the curb with safe control and positioning." },
    ],
  },
  {
    key: "intersection",
    title: "Intersection",
    items: [
      { key: "intersection_two_way_stops", label: "2-Way Stops", description: "Stops fully, yields correctly, and proceeds when safe." },
      { key: "intersection_four_way_stops", label: "4-Way / All-Way Stops", description: "Determines right of way and proceeds in the correct order." },
      { key: "intersection_traffic_lights", label: "Traffic Lights", description: "Responds safely to traffic signals and changing lights." },
      { key: "intersection_roundabouts", label: "Traffic Circle / Roundabout", description: "Approaches, yields, navigates, and exits safely." },
    ],
  },
  {
    key: "vehicle_control",
    title: "Vehicle Control",
    items: [
      { key: "vehicle_pre_trip", label: "Pre-Trip Inspection", description: "Checks essential vehicle controls and safety items before driving." },
      { key: "vehicle_steering", label: "Steering", description: "Maintains smooth steering and appropriate lane position." },
      { key: "vehicle_braking_acceleration", label: "Braking and Acceleration", description: "Accelerates and brakes smoothly with suitable spacing." },
      { key: "vehicle_turning_speed", label: "Appropriate Turning Speed", description: "Slows appropriately and maintains control through turns." },
    ],
  },
  {
    key: "traffic_rules",
    title: "Traffic Rules",
    items: [
      { key: "traffic_signs", label: "Signs", description: "Recognizes and responds correctly to road signs." },
      { key: "traffic_road_markings", label: "Road Markings", description: "Follows lane lines, stop lines, and other road markings." },
      { key: "traffic_emergency_vehicles", label: "Emergency Vehicles", description: "Responds safely and legally to emergency vehicles." },
      { key: "traffic_hov_bus_lanes", label: "HOV / Bus Lanes", description: "Understands and follows HOV and bus-lane restrictions." },
    ],
  },
  {
    key: "multi_lane_driving",
    title: "Multi-Lane Driving",
    items: [
      { key: "multi_lane_change", label: "Lane Change", description: "Signals, checks blind spots, and changes lanes safely." },
      { key: "multi_merging", label: "Merging", description: "Matches traffic speed and merges with safe space." },
      { key: "multi_highway", label: "Highway Driving", description: "Maintains safe speed, spacing, and lane discipline." },
    ],
  },
  {
    key: "other",
    title: "Other",
    items: [
      { key: "other_pull_away", label: "Pull Away", description: "Moves off smoothly after checking for hazards." },
      { key: "other_reversing_back", label: "Reversing Back", description: "Reverses under control while checking all around." },
      { key: "other_narrow_streets", label: "Sharing Narrow Streets", description: "Negotiates narrow roads courteously and safely." },
      { key: "other_refuelling", label: "Vehicle Refuelling", description: "Demonstrates safe vehicle refuelling steps." },
    ],
  },
  {
    key: "appropriate_pedal",
    title: "Choosing the Appropriate Pedal",
    items: [
      { key: "pedal_hazards", label: "Possible Hazard", description: "Chooses a suitable pedal response when hazards may arise." },
      { key: "pedal_hills", label: "Downhill / Uphill", description: "Selects appropriate pedal control on hills." },
      { key: "pedal_turns", label: "Turns", description: "Uses appropriate pedal control when turning." },
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
