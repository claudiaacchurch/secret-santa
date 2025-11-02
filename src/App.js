import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { supabase } from "./supabaseClient";

const getSiteBaseUrl = () => {
	if (typeof process !== "undefined" && process.env.REACT_APP_SITE_URL) {
		return process.env.REACT_APP_SITE_URL;
	}
	if (typeof window !== "undefined" && window.location?.origin) {
		return window.location.origin;
	}
	return "https://secret-santa-cpk.pages.dev";
};

const createGroupLink = () => {
	const slug = Math.random().toString(36).slice(2, 10);
	return {
		slug,
		url: `${getSiteBaseUrl()}/group/${slug}`,
	};
};
function App() {
	const slugFromPath = useMemo(() => {
		if (typeof window === "undefined") {
			return "";
		}
		const match = window.location.pathname.match(/^\/group\/([a-z0-9_-]+)$/i);
		return match ? match[1] : "";
	}, []);

	const [participants, setParticipants] = useState([]);
	const [assignments, setAssignments] = useState({});
	const [saveMessage, setSaveMessage] = useState("");
	const [lockMessage, setLockMessage] = useState("");
	const [selectedName, setSelectedName] = useState("");
	const [email, setEmail] = useState("");
	const [drawMessage, setDrawMessage] = useState("");
	const [groupLocked, setGroupLocked] = useState(false);
	const [groupLink, setGroupLink] = useState("");
	const [organiserEmail, setOrganiserEmail] = useState("");
	const [groupId, setGroupId] = useState(null);
	const [isSaving, setIsSaving] = useState(false);
	const [isLocking, setIsLocking] = useState(false);
	const [isResetting, setIsResetting] = useState(false);
	const [isEmailing, setIsEmailing] = useState(false);
	const [groupSlug, setGroupSlug] = useState(slugFromPath);
	const [isGroupLoading, setIsGroupLoading] = useState(false);
	const [organiserUnlocked, setOrganiserUnlocked] = useState(
		slugFromPath ? false : true
	);
	const [unlockModalOpen, setUnlockModalOpen] = useState(false);
	const [unlockInput, setUnlockInput] = useState("");
	const [unlockError, setUnlockError] = useState("");
	const [newParticipant, setNewParticipant] = useState("");
	const [addParticipantError, setAddParticipantError] = useState("");
	const [resetModalOpen, setResetModalOpen] = useState(false);

	const trimmedEmail = useMemo(() => email.trim().toLowerCase(), [email]);

	const handleAddParticipant = () => {
		if (groupLocked || isGroupLoading) {
			return;
		}

		const trimmed = newParticipant.trim();
		if (!trimmed) {
			setAddParticipantError("Enter a name before adding.");
			return;
		}

		const exists = participants.some(
			(name) => name.trim().toLowerCase() === trimmed.toLowerCase()
		);
		if (exists) {
			setAddParticipantError("That name is already on the list.");
			return;
		}

		setParticipants((current) => [...current, trimmed]);
		setNewParticipant("");
		setAddParticipantError("");
		setSaveMessage("");
	};

	const handleRemoveParticipant = (nameToRemove) => {
		if (groupLocked) {
			return;
		}

		setParticipants((current) =>
			current.filter((name) => name !== nameToRemove)
		);
		setAssignments((current) => {
			if (!current[nameToRemove]) {
				return current;
			}
			const next = { ...current };
			delete next[nameToRemove];
			return next;
		});
		setAddParticipantError("");
		setSaveMessage("");
	};

	const participantCountLabel = useMemo(() => {
		if (participants.length === 0) {
			return "Nobody added yet";
		}

		if (participants.length === 1) {
			return "1 person added";
		}

		return `${participants.length} people added`;
	}, [participants.length]);

	const handleSaveList = async () => {
		if (groupLocked) {
			setSaveMessage("The list is locked. Reset the event to make changes.");
			return;
		}

		if (!organiserEmail.trim()) {
			setSaveMessage("Please add an organiser email before saving.");
			return;
		}

		const uniqueNames = [];
		participants.forEach((name) => {
			const trimmed = name.trim();
			if (!trimmed) {
				return;
			}
			if (
				!uniqueNames.some(
					(existing) => existing.toLowerCase() === trimmed.toLowerCase()
				)
			) {
				uniqueNames.push(trimmed);
			}
		});

		setParticipants(uniqueNames);
		setAssignments({});
		setSelectedName("");
		setEmail("");
		setDrawMessage("");
		setGroupLink("");
		setGroupSlug("");
		setGroupLocked(false);
		setLockMessage("");

		if (uniqueNames.length === 0) {
			setSaveMessage("No names captured. Add at least one participant.");
			return;
		}

		setIsSaving(true);
		try {
			let response;

			if (groupId) {
				response = await supabase
					.from("groups")
					.update({ organiser_email: organiserEmail.trim() })
					.eq("id", groupId)
					.select()
					.maybeSingle();
			} else {
				response = await supabase
					.from("groups")
					.insert({ organiser_email: organiserEmail.trim() })
					.select()
					.maybeSingle();
			}

			if (response.error) {
				throw response.error;
			}

			const currentGroupId = response.data?.id || groupId;

			if (!currentGroupId) {
				throw new Error("No group ID returned from Supabase.");
			}

			setGroupId(currentGroupId);

			// Refresh participants for this group: remove old entries, insert new roster
			const deleteResponse = await supabase
				.from("participants")
				.delete()
				.eq("group_id", currentGroupId);

			if (deleteResponse.error) {
				throw deleteResponse.error;
			}

			const inserts = uniqueNames.map((name) => ({
				group_id: currentGroupId,
				name,
			}));

			if (inserts.length > 0) {
				const insertResponse = await supabase
					.from("participants")
					.insert(inserts);

				if (insertResponse.error) {
					throw insertResponse.error;
				}
			}

			setSaveMessage("Participant list saved. Generate group link to start.");
			setNewParticipant("");
			setAddParticipantError("");
		} catch (error) {
			console.error("Supabase save error", error);
			setSaveMessage("Could not save group. Try again.");
		} finally {
			setIsSaving(false);
		}
	};

	const handleGenerateGroupLink = async () => {
		if (!canGenerateLink && !groupLocked) {
			setLockMessage(
				"Save at least two names before generating the group link."
			);
			return;
		}

		if (groupLocked) {
			setLockMessage("Group is already locked. Share the link below.");
			return;
		}

		if (!groupId) {
			setLockMessage("Save the list before generating the link.");
			return;
		}

		setIsLocking(true);
		const { slug, url } = createGroupLink();

		try {
			const response = await supabase
				.from("groups")
				.update({ slug })
				.eq("id", groupId)
				.select()
				.maybeSingle();

			if (response.error) {
				throw response.error;
			}

			setGroupSlug(slug);
			setGroupLink(url);
			setGroupLocked(true);
			setLockMessage("Group locked. Share the link so everyone can draw.");
			setSaveMessage("");
			if (typeof window !== "undefined") {
				window.history.replaceState({}, "Secret Santa", `/group/${slug}`);
			}
			setOrganiserUnlocked(true);
			setUnlockError("");
		} catch (error) {
			console.error("Supabase lock error", error);
			setLockMessage("Could not lock group. Try again.");
		} finally {
			setIsLocking(false);
		}
	};

	const handleDraw = async () => {
		if (!groupLocked) {
			setDrawMessage("Waiting for the organiser to generate the group link.");
			return;
		}

		if (!trimmedEmail) {
			setDrawMessage("Enter your email before drawing.");
			return;
		}

		if (participants.length < 2) {
			setDrawMessage("Need at least two people before anyone can draw.");
			return;
		}

		if (!selectedName) {
			setDrawMessage("Pick your name from the list first.");
			return;
		}

		if (!groupId) {
			setDrawMessage("Ask the organiser to refresh the page before drawing.");
			return;
		}

		setIsEmailing(true);

		let mergedAssignments = { ...assignments };
		const remoteAssignments = {};

		try {
			const { data: participantRows, error: participantsError } = await supabase
				.from("participants")
				.select("name, email, giftee_name, drawn_at")
				.eq("group_id", groupId);

			if (participantsError) {
				console.error("Supabase fetch assignments error", participantsError);
			} else if (participantRows) {
				participantRows.forEach(
					({ name, email: rowEmail, giftee_name: gifteeName, drawn_at }) => {
						if (!gifteeName) {
							return;
						}

						remoteAssignments[name] = {
							giftee: gifteeName,
							email: rowEmail || mergedAssignments[name]?.email || "",
							timestamp: drawn_at
								? new Date(drawn_at).getTime()
								: mergedAssignments[name]?.timestamp || Date.now(),
						};
					}
				);

				if (Object.keys(remoteAssignments).length > 0) {
					mergedAssignments = { ...mergedAssignments, ...remoteAssignments };
					setAssignments((current) => ({
						...current,
						...remoteAssignments,
					}));
				}
			}
		} catch (fetchError) {
			console.error("Supabase assignments fetch failed", fetchError);
		}

		let existingAssignment = mergedAssignments[selectedName];

		if (existingAssignment) {
			if (
				existingAssignment.email &&
				existingAssignment.email !== trimmedEmail
			) {
				setDrawMessage("Looks like someone already claimed this name.");
				setIsEmailing(false);
				return;
			}

			const { error: updateError } = await supabase
				.from("participants")
				.update({ email: trimmedEmail })
				.eq("group_id", groupId)
				.eq("name", selectedName);

			if (updateError) {
				console.error("Supabase update email error", updateError);
			}

			const refreshedAssignment = {
				...existingAssignment,
				email: trimmedEmail,
			};
			mergedAssignments[selectedName] = refreshedAssignment;
			setAssignments((current) => ({
				...current,
				[selectedName]: refreshedAssignment,
			}));

			try {
				const { data: emailResult, error: emailError } =
					await supabase.functions.invoke("send_giftee_email", {
						body: {
							groupId,
							gifterName: selectedName,
							gifteeName: refreshedAssignment.giftee,
							email: trimmedEmail,
						},
					});

				if (emailError || emailResult?.error) {
					console.error(
						"Supabase email function error",
						emailError || emailResult?.error
					);
					setDrawMessage(
						"We found your draw but couldn't send the email. Ask the organiser to resend."
					);
					setIsEmailing(false);
					return;
				}
			} catch (invokeError) {
				console.error("Supabase email function exception", invokeError);
				setDrawMessage(
					"We found your draw but couldn't send the email. Ask the organiser to resend."
				);
				setIsEmailing(false);
				return;
			}

			setDrawMessage("We just resent your match to your email.");
			setIsEmailing(false);
			return;
		}

		const takenGiftees = new Set(
			Object.values(mergedAssignments)
				.map((entry) => entry && entry.giftee)
				.filter(Boolean)
		);
		const availableGiftees = participants.filter(
			(name) => name !== selectedName && !takenGiftees.has(name)
		);

		if (availableGiftees.length === 0) {
			setDrawMessage(
				"Everyone else has already been matched. Ask the organiser to reset."
			);
			setIsEmailing(false);
			return;
		}

		const randomIndex = Math.floor(Math.random() * availableGiftees.length);
		const giftee = availableGiftees[randomIndex];

		const { error: drawError } = await supabase
			.from("participants")
			.update({
				email: trimmedEmail,
				giftee_name: giftee,
				drawn_at: new Date().toISOString(),
			})
			.eq("group_id", groupId)
			.eq("name", selectedName)
			.is("giftee_name", null);

		if (drawError) {
			console.error("Supabase draw update error", drawError);
			setDrawMessage("Could not store your draw. Try again.");
			setIsEmailing(false);
			return;
		}

		mergedAssignments = {
			...mergedAssignments,
			[selectedName]: { giftee, email: trimmedEmail, timestamp: Date.now() },
		};
		setAssignments(mergedAssignments);

		try {
			const { data: emailResult, error: emailError } =
				await supabase.functions.invoke("send_giftee_email", {
					body: {
						groupId,
						gifterName: selectedName,
						gifteeName: giftee,
						email: trimmedEmail,
					},
				});

			if (emailError || emailResult?.error) {
				console.error(
					"Supabase email function error",
					emailError || emailResult?.error
				);
				setDrawMessage(
					"We saved your draw but couldn't send the email. Ask the organiser to resend."
				);
				setIsEmailing(false);
				return;
			}
		} catch (invokeError) {
			console.error("Supabase email function exception", invokeError);
			setDrawMessage(
				"We saved your draw but couldn't send the email. Ask the organiser to resend."
			);
			setIsEmailing(false);
			return;
		}

		setDrawMessage(
			"All set! We just emailed you the name you drew (check your junk)."
		);
		setIsEmailing(false);
	};

	const confirmResetGroup = async () => {
		setIsResetting(true);
		try {
			if (groupId) {
				const { error: deleteParticipantsError } = await supabase
					.from("participants")
					.delete()
					.eq("group_id", groupId);
				if (deleteParticipantsError) {
					throw deleteParticipantsError;
				}
			}

			setParticipants([]);
			setAssignments({});
			setSelectedName("");
			setEmail("");
			setDrawMessage("");
			setGroupLocked(false);
			setLockMessage("");
			setSaveMessage("Group reset. Add names to start again.");
			setOrganiserUnlocked(false);
			setUnlockError("");
			setNewParticipant("");
			setAddParticipantError("");
			setResetModalOpen(false);
			setUnlockModalOpen(true);
		} catch (error) {
			console.error("Supabase reset error", error);
			setSaveMessage("Could not reset group. Try again.");
		} finally {
			setIsResetting(false);
		}
	};

	const openUnlockModal = () => {
		setUnlockInput("");
		setUnlockError("");
		setUnlockModalOpen(true);
	};

	const confirmOrganiserUnlock = () => {
		const attempt = unlockInput.trim().toLowerCase();
		if (!organiserEmail) {
			setOrganiserUnlocked(true);
			setUnlockError("");
			setUnlockModalOpen(false);
			return;
		}

		if (attempt === organiserEmail.trim().toLowerCase()) {
			setOrganiserUnlocked(true);
			setUnlockError("");
			setUnlockModalOpen(false);
			setUnlockInput("");
		} else {
			setUnlockError("That email doesn't match the organiser on file.");
		}
	};

	useEffect(() => {
		if (!trimmedEmail) {
			return;
		}

		const ownedEntry = Object.entries(assignments).find(
			([, value]) => value && value.email === trimmedEmail
		);

		if (!ownedEntry) {
			return;
		}

		const [name] = ownedEntry;
		setSelectedName((current) => {
			if (current && current === name) {
				return current;
			}

			const currentAssignment = current ? assignments[current] : null;
			if (!currentAssignment || currentAssignment.email !== trimmedEmail) {
				return name;
			}

			return current;
		});
	}, [assignments, trimmedEmail, selectedName]);

	useEffect(() => {
		const slug = slugFromPath || groupSlug;
		if (!slug) {
			return;
		}

		if (
			groupId &&
			(groupSlug === slug || (!slugFromPath && groupSlug)) &&
			participants.length > 0
		) {
			return;
		}

		let isCancelled = false;

		const loadGroup = async () => {
			setIsGroupLoading(true);

			const { data: groupRow, error: groupError } = await supabase
				.from("groups")
				.select("id, organiser_email, slug")
				.eq("slug", slug)
				.maybeSingle();

			if (groupError || !groupRow) {
				if (!isCancelled) {
					setLockMessage(
						"We couldn't find that group. Ask your organiser for a fresh link."
					);
				}
				setIsGroupLoading(false);
				return;
			}

			const { data: participantRows, error: participantsError } = await supabase
				.from("participants")
				.select("name, email, giftee_name, drawn_at")
				.eq("group_id", groupRow.id)
				.order("name", { ascending: true });

			if (participantsError) {
				console.error("Supabase participants fetch error", participantsError);
				if (!isCancelled) {
					setLockMessage(
						"We couldn't load participants right now. Try refreshing."
					);
				}
				setIsGroupLoading(false);
				return;
			}

			const roster = (participantRows ?? []).map(
				(participant) => participant.name
			);
			const assignmentsFromDb = {};

			(participantRows ?? []).forEach((participant) => {
				if (!participant.giftee_name) {
					return;
				}

				assignmentsFromDb[participant.name] = {
					giftee: participant.giftee_name,
					email: participant.email || "",
					timestamp: participant.drawn_at
						? new Date(participant.drawn_at).getTime()
						: Date.now(),
				};
			});

			if (isCancelled) {
				return;
			}

			if (!organiserUnlocked) {
				setUnlockError("");
			}
			setGroupId(groupRow.id);
			setGroupSlug(groupRow.slug || slug);
			setGroupLink(`${getSiteBaseUrl()}/group/${groupRow.slug || slug}`);
			setOrganiserEmail(groupRow.organiser_email || "");
			setParticipants(roster);
			setAssignments(assignmentsFromDb);
			setNewParticipant("");
			setAddParticipantError("");
			setGroupLocked(true);
			setSaveMessage("");
			setLockMessage("Group locked. Share the link so everyone can draw.");
			setIsGroupLoading(false);
		};

		loadGroup();

		return () => {
			isCancelled = true;
		};
	}, [
		groupSlug,
		slugFromPath,
		groupId,
		participants.length,
		organiserUnlocked,
	]);

	const selectedAssignment = selectedName ? assignments[selectedName] : null;

	const drawDisabled =
		!groupLocked ||
		participants.length < 2 ||
		!selectedName ||
		!trimmedEmail ||
		isGroupLoading;

	const selectDisabled =
		!groupLocked || participants.length === 0 || isGroupLoading;

	const canReset =
		participants.length > 0 ||
		groupLocked ||
		Object.keys(assignments).length > 0;

	const canGenerateLink =
		participants.length >= 2 && !groupLocked && !isGroupLoading;

	const statusMessage = (() => {
		if (isGroupLoading) {
			return "Loading group details...";
		}

		if (!groupLocked) {
			return "Organiser is still setting things up.";
		}

		if (!trimmedEmail) {
			return "Enter your email so we know who is drawing.";
		}

		if (!selectedName) {
			return "Pick your name from the list to continue.";
		}

		return "Ready when you are - hit the button and we will email your match.";
	})();

	return (
		<div className="app">
			<header className="header">
				<h1> 🤶 Secret Santa Draw</h1>
			</header>
			<main className="panels">
				{organiserUnlocked ? (
					<section className="panel">
						<div className="panel-header">
							<h2>Get Started</h2>
						</div>
						<label className="field-label" htmlFor="organiser-email">
							To start the draw, enter your email as the organiser.
						</label>
						<input
							id="organiser-email"
							className="field-control"
							type="email"
							placeholder="organiser@email.com"
							value={organiserEmail}
							onChange={(event) => setOrganiserEmail(event.target.value)}
							disabled={isGroupLoading}
						/>
						<label className="field-label" htmlFor="participant-name">
							Add everyone's names (and your own):
						</label>
						<div className="add-participant-row">
							<input
								id="participant-name"
								className="field-control"
								placeholder="e.g. Claudia Church"
								value={newParticipant}
								onChange={(event) => {
									setNewParticipant(event.target.value);
									setAddParticipantError("");
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										handleAddParticipant();
									}
								}}
								disabled={groupLocked || isGroupLoading}
							/>
							<button
								className="button primary"
								type="button"
								onClick={handleAddParticipant}
								disabled={
									groupLocked || isGroupLoading || !newParticipant.trim()
								}
							>
								Add
							</button>
						</div>
						{addParticipantError ? (
							<div className="status error">{addParticipantError}</div>
						) : null}
						<div className="group-actions">
							<button
								className="button primary"
								type="button"
								onClick={handleSaveList}
								disabled={groupLocked || isSaving || isGroupLoading}
							>
								{isSaving ? "Saving…" : "Save list"}
							</button>
							<button
								className="button secondary"
								type="button"
								onClick={handleGenerateGroupLink}
								disabled={
									(!groupLocked && !canGenerateLink) ||
									isLocking ||
									isGroupLoading
								}
							>
								{groupLocked
									? "Share group link"
									: isLocking
									? "Generating…"
									: "Generate group link"}
							</button>
							<button
								className="button ghost"
								type="button"
								onClick={() => setResetModalOpen(true)}
								disabled={!canReset || isResetting}
							>
								{isResetting ? "Resetting…" : "Reset group"}
							</button>
						</div>
						{saveMessage ? <div className="status">{saveMessage}</div> : null}
						{lockMessage ? <div className="status">{lockMessage}</div> : null}
						{groupLink ? (
							<div className="group-link">
								<span>Group link</span>
								<code>{groupLink}</code>
								<p>
									Send this URL to everyone participating to draw their name.
								</p>
							</div>
						) : null}
						<div className="names-preview" aria-live="polite">
							<p>{participantCountLabel}</p>
							{participants.length > 0 ? (
								<ul>
									{participants.map((name) => {
										const assignment = assignments[name];
										const claimed = Boolean(assignment);
										return (
											<li key={name}>
												<div className="name-main">
													<span>{name}</span>
													<span
														className={`name-tag${
															claimed ? " claimed" : " pending"
														}`}
													>
														{claimed ? "claimed" : "waiting"}
													</span>
													{!groupLocked ? (
														<button
															type="button"
															className="remove-name"
															onClick={() => handleRemoveParticipant(name)}
														>
															Remove
														</button>
													) : null}
												</div>
											</li>
										);
									})}
								</ul>
							) : (
								<p className="names-empty">
									No one added yet. Add names above to build your roster.
								</p>
							)}
						</div>
						<div className="info">
							Once the group link is generated, the list freezes. You can still
							check who has drawn, but changes require a reset.
						</div>
					</section>
				) : (
					<section className="panel organiser-locked">
						<div className="panel-header">
							<h2>Draw Already Started</h2>
						</div>
						<p>
							Only the organiser can edit the participants. If that’s you,
							unlock the tools with the organiser email.
						</p>
						<button
							className="button ghost"
							type="button"
							onClick={openUnlockModal}
						>
							I'm the organiser
						</button>
					</section>
				)}
				<section className="panel">
					<div className="panel-header">
						<h2>Draw your Giftee!</h2>
						<p>Enter your email to claim your name.</p>
					</div>
					<div className="auth-group">
						<div className="auth-field">
							<label className="field-label" htmlFor="email">
								Email
							</label>
							<input
								id="email"
								className="field-control"
								placeholder="name@email.com"
								type="email"
								value={email}
								onChange={(event) => {
									setEmail(event.target.value);
									setDrawMessage("");
								}}
								disabled={!groupLocked}
							/>
						</div>
						<div className="auth-field">
							<label className="field-label" htmlFor="lookup">
								Who are you
							</label>
							<select
								id="lookup"
								className="field-control"
								value={selectedName}
								onChange={(event) => {
									setSelectedName(event.target.value);
									setDrawMessage("");
								}}
								disabled={selectDisabled}
							>
								<option value="">
									{participants.length === 0
										? "Waiting for organiser"
										: "Choose your name from the list"}
								</option>
								{participants.map((name) => {
									const assignment = assignments[name];
									const claimedBySomeoneElse =
										assignment &&
										assignment.email &&
										assignment.email !== trimmedEmail;
									return (
										<option
											key={name}
											value={name}
											disabled={claimedBySomeoneElse}
										>
											{name}
											{assignment
												? claimedBySomeoneElse
													? " (taken)"
													: " (yours)"
												: ""}
										</option>
									);
								})}
							</select>
						</div>
					</div>
					<button
						className="button secondary"
						type="button"
						onClick={handleDraw}
						disabled={drawDisabled || isEmailing}
					>
						{isEmailing
							? "Sending…"
							: selectedAssignment && selectedAssignment.email === trimmedEmail
							? "Email me my person"
							: "Draw my person"}
					</button>
					<div className="draw-status">{drawMessage || statusMessage}</div>
				</section>
			</main>
			{unlockModalOpen && (
				<div className="modal-backdrop" role="dialog" aria-modal="true">
					<div className="modal">
						<h3>Unlock organiser tools</h3>
						<p className="modal-copy">
							Enter the organiser email to unlock edits for this group.
						</p>
						<input
							type="email"
							className="field-control"
							placeholder="organiser@email.com"
							value={unlockInput}
							onChange={(event) => {
								setUnlockInput(event.target.value);
								setUnlockError("");
							}}
							autoFocus
						/>
						{unlockError ? (
							<div className="status error">{unlockError}</div>
						) : null}
						<div className="modal-actions">
							<button
								className="button secondary"
								type="button"
								onClick={confirmOrganiserUnlock}
							>
								Unlock
							</button>
							<button
								className="button ghost"
								type="button"
								onClick={() => {
									setUnlockModalOpen(false);
									setUnlockInput("");
									setUnlockError("");
								}}
							>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}
			{resetModalOpen && (
				<div className="modal-backdrop" role="dialog" aria-modal="true">
					<div className="modal">
						<h3>Reset this group?</h3>
						<p className="modal-copy">
							This clears the roster and all assignments. Participants will need
							to draw again.
						</p>
						<div className="modal-actions">
							<button
								className="button secondary"
								type="button"
								onClick={confirmResetGroup}
								disabled={isResetting}
							>
								{isResetting ? "Resetting…" : "Yes, reset"}
							</button>
							<button
								className="button ghost"
								type="button"
								onClick={() => setResetModalOpen(false)}
								disabled={isResetting}
							>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

export default App;
