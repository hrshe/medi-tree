"""Default sample Medinetz decision tree template (customizable by admins)."""

SAMPLE_TREE = {
    "title": "Medinetz Case Intake & Triage Guide",
    "description": (
        "Static decision-support template for Medinetz volunteers to route "
        "anonymous consultations safely and consistently. No client data is saved."
    ),
    "rootNodeId": "n_emergency",
    "nodes": [
        {
            "id": "n_emergency",
            "type": "question",
            "title": "Emergency Red Flags?",
            "prompt": "Does the person show any immediate life-threatening or acute emergency symptoms?",
            "guidance": (
                "Check for chest pain, severe shortness of breath, heavy bleeding, "
                "loss of consciousness, stroke signs, acute suicidal crisis, or severe trauma."
            ),
            "outcomeLevel": "action",
            "checklist": [],
            "position": {"x": 420, "y": 40},
        },
        {
            "id": "n_out_112",
            "type": "outcome",
            "title": "Immediate Emergency (Call 112)",
            "prompt": (
                "Do not delay for paperwork or status clarification. Emergency medical care "
                "takes immediate priority."
            ),
            "guidance": "Emergency hospitals are obligated to treat acute life-threatening emergencies.",
            "outcomeLevel": "urgent",
            "checklist": [
                "Call 112 (or escort to nearest emergency department if safe)",
                "Share only medically necessary symptom information",
                "Arrange emergency language support if available",
                "Do NOT store patient name or contact details in this tool",
            ],
            "position": {"x": 80, "y": 280},
        },
        {
            "id": "n_language",
            "type": "question",
            "title": "Language & Communication",
            "prompt": "Can the consultation proceed clearly in a shared language, or is translation needed?",
            "guidance": "Ensure informed understanding before discussing symptoms or referrals.",
            "outcomeLevel": "action",
            "checklist": [],
            "position": {"x": 580, "y": 260},
        },
        {
            "id": "n_out_interpreter",
            "type": "outcome",
            "title": "Arrange Interpreter First",
            "prompt": (
                "Pause clinical routing and connect a trusted volunteer interpreter or "
                "medical translation service before continuing."
            ),
            "guidance": "Avoid using unverified bystanders for sensitive medical history when possible.",
            "outcomeLevel": "info",
            "checklist": [
                "Check Medinetz internal interpreter roster",
                "Confirm dialect and preferred gender of interpreter if requested",
                "Restart this decision guide once communication is established",
            ],
            "position": {"x": 280, "y": 500},
        },
        {
            "id": "n_coverage",
            "type": "question",
            "title": "Insurance / Coverage Status",
            "prompt": "Does the person currently have usable health insurance or safe access to regular care?",
            "guidance": (
                "Consider fear of reporting, undocumented status, EU citizens without coverage, "
                "or rejected asylum/insurance gaps."
            ),
            "outcomeLevel": "action",
            "checklist": [],
            "position": {"x": 760, "y": 480},
        },
        {
            "id": "n_care_type",
            "type": "question",
            "title": "Primary Care Need Category",
            "prompt": "Which type of medical or support need is the primary concern today?",
            "guidance": "Pick the closest category to determine the appropriate Medinetz partner network.",
            "outcomeLevel": "action",
            "checklist": [],
            "position": {"x": 540, "y": 720},
        },
        {
            "id": "n_out_social_advice",
            "type": "outcome",
            "title": "Clearing House / Social Counseling",
            "prompt": (
                "If regular insurance exists or can be activated safely, guide the person toward "
                "mainstream care or an independent clearing house."
            ),
            "guidance": "Verify whether any residency or registration concerns prevent direct clinic visits.",
            "outcomeLevel": "referral",
            "checklist": [
                "Explain rights to confidential healthcare access",
                "Provide contact for local Clearingstelle / social counseling",
                "Offer follow-up Medinetz office hours contact card",
            ],
            "position": {"x": 1000, "y": 720},
        },
        {
            "id": "n_out_gp",
            "type": "outcome",
            "title": "Refer to Partner General Practitioner",
            "prompt": (
                "Issue an anonymous Medinetz referral/cost-coverage note for a cooperating "
                "general practitioner or pediatrician."
            ),
            "guidance": "Use an anonymous case code on paper vouchers only — never enter personal data online.",
            "outcomeLevel": "action",
            "checklist": [
                "Check current GP availability in the internal offline partner list",
                "Prepare anonymous referral slip with date & discipline",
                "Explain medication voucher procedure if a prescription is expected",
            ],
            "position": {"x": 160, "y": 980},
        },
        {
            "id": "n_out_obgyn",
            "type": "outcome",
            "title": "Urgent Prenatal / OB-GYN Pathway",
            "prompt": (
                "Prioritize timely referral to a cooperating OB-GYN clinic or midwife network, "
                "especially for pregnancy care or acute gynecological symptoms."
            ),
            "guidance": "Maternity protection rules may provide additional safe funding options.",
            "outcomeLevel": "referral",
            "checklist": [
                "Coordinate directly with cooperating OB-GYN practice",
                "Check eligibility for anonymous maternity support / hospital birth coverage",
                "Schedule interpreter support for the appointment if needed",
            ],
            "position": {"x": 540, "y": 980},
        },
        {
            "id": "n_out_mental",
            "type": "outcome",
            "title": "Psychosocial / Specialized Support",
            "prompt": (
                "Connect with trauma-informed psychosocial counselors, cooperating psychiatrists, "
                "or specialized local NGOs."
            ),
            "guidance": "If acute self-harm risk emerges at any point, switch immediately to 112 / crisis team.",
            "outcomeLevel": "referral",
            "checklist": [
                "Provide low-barrier psychosocial counseling contacts",
                "Confirm safe callback/contact method chosen by the client",
                "Coordinate follow-up only via agreed anonymous channel",
            ],
            "position": {"x": 920, "y": 980},
        },
    ],
    "edges": [
        {
            "id": "e_1",
            "source": "n_emergency",
            "target": "n_out_112",
            "label": "Yes — acute emergency signs",
            "order": 1,
        },
        {
            "id": "e_2",
            "source": "n_emergency",
            "target": "n_language",
            "label": "No — stable / non-emergency",
            "order": 2,
        },
        {
            "id": "e_3",
            "source": "n_language",
            "target": "n_out_interpreter",
            "label": "Interpreter needed first",
            "order": 1,
        },
        {
            "id": "e_4",
            "source": "n_language",
            "target": "n_coverage",
            "label": "Communication is clear",
            "order": 2,
        },
        {
            "id": "e_5",
            "source": "n_coverage",
            "target": "n_care_type",
            "label": "No coverage or unsafe to use",
            "order": 1,
        },
        {
            "id": "e_6",
            "source": "n_coverage",
            "target": "n_out_social_advice",
            "label": "Has usable coverage / clearing option",
            "order": 2,
        },
        {
            "id": "e_7",
            "source": "n_care_type",
            "target": "n_out_gp",
            "label": "General medicine / pediatrics / dental",
            "order": 1,
        },
        {
            "id": "e_8",
            "source": "n_care_type",
            "target": "n_out_obgyn",
            "label": "Pregnancy / gynecology",
            "order": 2,
        },
        {
            "id": "e_9",
            "source": "n_care_type",
            "target": "n_out_mental",
            "label": "Mental health / psychosocial",
            "order": 3,
        },
    ],
}
